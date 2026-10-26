import { spawn } from "node:child_process";
import { PhantomNotInstalledError, StackError } from "./errors.ts";

/**
 * Thin wrapper around the `phantom` CLI. Stack never stores secrets locally —
 * every read/write goes through Phantom. If Phantom is missing, we surface a
 * clear install hint instead of silently falling back to a weaker store.
 */

export interface PhantomExecResult {
  stdout: string;
  stderr: string;
  code: number;
  signal?: NodeJS.Signals;
  completion?: "exited" | "signal" | "unknown";
}

/** Interpret close fields only; this does not attest provider or vault state. */
export function completionForClose(
  code: number | null,
  signal: NodeJS.Signals | null,
): NonNullable<PhantomExecResult["completion"]> {
  return signal ? "signal" : code === null ? "unknown" : "exited";
}

let cachedInstalled: boolean | undefined;

export async function isPhantomInstalled(opts?: { timeoutMs?: number }): Promise<boolean> {
  if (cachedInstalled !== undefined) return cachedInstalled;
  try {
    const result = await exec(
      ["--version"],
      opts?.timeoutMs !== undefined
        ? { allowFailure: true, timeoutMs: opts.timeoutMs }
        : { allowFailure: true },
    );
    cachedInstalled = result.code === 0 && result.completion === "exited";
  } catch {
    cachedInstalled = false;
  }
  return cachedInstalled;
}

export async function assertPhantomInstalled(): Promise<void> {
  if (!(await isPhantomInstalled())) throw new PhantomNotInstalledError();
}

export interface ExecOptions {
  cwd?: string;
  allowFailure?: boolean;
  stdin?: string;
  /** If true, inherit stdio so interactive flows (OAuth browser) work. */
  interactive?: boolean;
  /** Kill the phantom child after this many milliseconds. */
  timeoutMs?: number;
}

export async function exec(args: string[], opts: ExecOptions = {}): Promise<PhantomExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("phantom", args, {
      cwd: opts.cwd,
      stdio: opts.interactive ? "inherit" : ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    if (typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, opts.timeoutMs);
    }

    if (!opts.interactive) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      if (opts.stdin !== undefined) {
        // Phantom may refuse (e.g. an existing name) and exit before reading
        // stdin; the exit code reports that, so a broken pipe is not fatal.
        child.stdin?.on("error", () => {});
        child.stdin?.write(opts.stdin);
        child.stdin?.end();
      }
    }

    child.on("error", (err) => {
      clearTimer();
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new PhantomNotInstalledError());
        return;
      }
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimer();
      // A signal/unknown exit is not evidence that a vault mutation committed.
      const result: PhantomExecResult = {
        stdout,
        stderr,
        code: signal ? code || 1 : (code ?? 1),
        completion: completionForClose(code, signal),
        ...(signal ? { signal } : {}),
      };
      if (result.code !== 0 && !opts.allowFailure) {
        reject(
          new StackError(
            "PHANTOM_EXEC_FAILED",
            result.completion === "exited"
              ? `phantom ${formatArgsForError(args)} failed (exit ${result.code}): ${stderr.trim() || stdout.trim()}`
              : `phantom ${formatArgsForError(args)} did not complete (${result.completion}); result unconfirmed`,
          ),
        );
        return;
      }
      resolvePromise(result);
    });
  });
}

/**
 * Store a NEW secret. The value goes over stdin (`phantom add KEY --stdin`):
 * Phantom Secrets >= 0.7.3 rejects a positional value because argv is visible
 * to process inspection. Phantom never replaces an existing name, so a
 * every completed collision surfaces as `PHANTOM_SECRET_EXISTS`. Historical
 * input equality is never evidence that the current vault still has that value.
 */
export async function addSecret(key: string, value: string, cwd?: string): Promise<void> {
  // Phantom 0.7.9 reads one stdin line and strips CR/LF. Refuse values it
  // cannot preserve before any subprocess, rather than silently truncating.
  if (/[\r\n]/.test(value)) {
    throw new StackError(
      "PHANTOM_SECRET_VALUE_UNSUPPORTED",
      "Phantom Secrets accepts one line per secret; CR/LF values cannot be stored unchanged.",
    );
  }
  await assertPhantomInstalled();
  const result = await exec(["add", key, "--stdin"], { cwd, stdin: value, allowFailure: true });
  // Collision wording from an interrupted child cannot attest a completed
  // create-only refusal.
  if (result.completion !== "exited") {
    throw new StackError(
      "PHANTOM_EXEC_FAILED",
      "Phantom add did not complete; secret storage is unconfirmed.",
    );
  }
  if (result.code === 0) {
    return;
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  if (/already protected|already exists/i.test(detail)) {
    throw new StackError(
      "PHANTOM_SECRET_EXISTS",
      `${key} is already stored in Phantom, and Phantom never replaces a stored secret. Run \`phantom remove ${key}\` in your terminal, then retry.`,
    );
  }
  throw new StackError(
    "PHANTOM_EXEC_FAILED",
    `phantom add ${key} --stdin failed (exit ${result.code}): ${detail}`,
  );
}

/**
 * Remove a secret. Phantom Secrets requires a typed confirmation in an
 * attached terminal for `remove`, so headless callers (rollback, CI, agents)
 * cannot remove anything. Pass `interactive: true` only from a human-driven
 * CLI command with a TTY; Phantom then runs its own confirmation prompt.
 * Returns true only when Phantom reports the secret removed.
 */
export async function removeSecret(
  key: string,
  cwd?: string,
  opts: { interactive?: boolean } = {},
): Promise<boolean> {
  await assertPhantomInstalled();
  const result = await exec(["remove", key], {
    cwd,
    allowFailure: true,
    interactive: opts.interactive === true,
  });
  const removed = result.code === 0 && result.completion === "exited";
  return removed;
}

/**
 * Secret names in the vault, from `phantom list --json` (never values). The
 * human `phantom list` output is a decorated table and is not parsed.
 */
export async function listSecrets(
  cwd?: string,
  opts?: { timeoutMs?: number; skipInstallCheck?: boolean },
): Promise<string[]> {
  if (!opts?.skipInstallCheck) await assertPhantomInstalled();
  const { stdout, code } = await exec(["list", "--json"], {
    cwd,
    allowFailure: true,
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  if (code !== 0) {
    throw new StackError(
      "PHANTOM_METADATA_UNAVAILABLE",
      "Phantom secret inventory is unavailable; stored names are unknown.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new StackError(
      "PHANTOM_OUTPUT_UNRECOGNIZED",
      "phantom list --json did not return JSON; upgrade Phantom Secrets to 0.7.9 or newer.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new StackError(
      "PHANTOM_OUTPUT_UNRECOGNIZED",
      "phantom list --json did not return an array.",
    );
  }
  const names: string[] = [];
  for (const entry of parsed) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !("name" in entry) ||
      typeof entry.name !== "string" ||
      entry.name.length === 0
    ) {
      throw new StackError(
        "PHANTOM_OUTPUT_UNRECOGNIZED",
        "phantom list --json contains unrecognized secret-name metadata.",
      );
    }
    names.push(entry.name);
  }
  return names;
}

/**
 * Number of secrets in the vault, from `phantom list --json`. Null when the
 * inventory cannot be read (Phantom missing, no .phantom.toml, unrecognized
 * output), so callers never report an unreadable vault as empty.
 */
export async function countSecrets(
  cwd?: string,
  opts?: { timeoutMs?: number; skipInstallCheck?: boolean },
): Promise<number | null> {
  try {
    // skipInstallCheck lets `stack status` overlap this list with the version probe.
    if (
      !opts?.skipInstallCheck &&
      !(await isPhantomInstalled(
        opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : undefined,
      ))
    ) {
      return null;
    }
    return (await listSecrets(cwd, opts)).length;
  } catch {
    return null;
  }
}

/** Configuration observation only: no vault access, initialization or grants. */
export async function assertProjectInitialized(cwd?: string): Promise<void> {
  await assertPhantomInstalled();
  const result = await exec(["status", "--json"], { cwd, allowFailure: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = undefined;
  }
  if (
    result.code !== 0 ||
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("schema_version" in parsed) ||
    parsed.schema_version !== 1 ||
    !("inspection" in parsed) ||
    parsed.inspection !== "metadata-only" ||
    !("initialized" in parsed) ||
    typeof parsed.initialized !== "boolean"
  ) {
    throw new StackError(
      "PHANTOM_METADATA_UNAVAILABLE",
      "Phantom project initialization is unknown. Use Phantom Secrets 0.7.9 or newer and check its metadata status before retrying.",
    );
  }
  if (!parsed.initialized) {
    throw new StackError(
      "PHANTOM_PROJECT_NOT_INITIALIZED",
      "Phantom project is not initialized or its configuration is unreadable. Review `phantom status --json`; for a new project run `phantom init --empty` in a trusted terminal, then retry.",
    );
  }
}

/**
 * Read a secret value. Phantom Secrets >= 0.7.3 only reveals into an attached
 * terminal after a typed confirmation, so from Stack (piped stdio) this fails
 * with `PHANTOM_TRUSTED_TERMINAL_REQUIRED`. Callers must treat a stored value
 * as unreadable and fall back to prompting.
 */
export async function revealSecret(key: string, cwd?: string): Promise<string> {
  await assertPhantomInstalled();
  const result = await exec(["reveal", key], { cwd, allowFailure: true });
  if (result.code === 0) return result.stdout.trim();
  const detail = result.stderr.trim();
  if (/terminal/i.test(detail)) {
    throw new StackError(
      "PHANTOM_TRUSTED_TERMINAL_REQUIRED",
      `Phantom only reveals ${key} in an attached terminal after typed confirmation; Stack cannot read it.`,
    );
  }
  throw new StackError("PHANTOM_EXEC_FAILED", `phantom reveal ${key} failed (exit ${result.code})`);
}

export async function ensureInitialized(cwd?: string): Promise<void> {
  await assertPhantomInstalled();
  const result = await exec(["status"], { cwd, allowFailure: true });
  if (result.code !== 0 || /not initialized/i.test(result.stdout + result.stderr)) {
    await exec(["init"], { cwd, interactive: true });
  }
}

export async function syncToPlatform(
  platform: "vercel" | "railway" | "fly",
  projectId: string,
  cwd?: string,
): Promise<void> {
  await assertPhantomInstalled();
  await exec(["sync", "--platform", platform, "--project", projectId], { cwd, interactive: true });
}

/**
 * For tests only. Resets the installation-detection cache so a fake `phantom`
 * binary placed on PATH by a test harness can be picked up.
 */
export function __resetPhantomCache(): void {
  cachedInstalled = undefined;
}

/**
 * Redact the secret value in phantom CLI arg lists before they're interpolated
 * into any error message or log line. `phantom add <KEY> <VALUE>` is the main
 * risk surface: without this, a non-zero exit would leak the raw secret in the
 * thrown error. Also redacts `add-secret` just in case a future MCP sub-tool
 * shells out with a different verb.
 */
function formatArgsForError(args: string[]): string {
  const SENSITIVE_FOLLOWERS = new Set(["add", "add-secret"]);
  const redacted = args.map((arg, i) => {
    const prev = args[i - 1];
    // For `add KEY VALUE`, the third arg (i=2 if args[0] is the verb) is the value.
    if (SENSITIVE_FOLLOWERS.has(args[0]) && i === 2) return "<redacted>";
    // `reveal KEY` has no secret value in args, but belt-and-suspenders for future verbs.
    if (prev && SENSITIVE_FOLLOWERS.has(prev) && i === 2) return "<redacted>";
    return arg;
  });
  return redacted.join(" ");
}
