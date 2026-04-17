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
}

let cachedInstalled: boolean | undefined;

export async function isPhantomInstalled(): Promise<boolean> {
  if (cachedInstalled !== undefined) return cachedInstalled;
  try {
    const result = await exec(["--version"], { allowFailure: true });
    cachedInstalled = result.code === 0;
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
}

export async function exec(args: string[], opts: ExecOptions = {}): Promise<PhantomExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("phantom", args, {
      cwd: opts.cwd,
      stdio: opts.interactive ? "inherit" : ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (!opts.interactive) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      if (opts.stdin !== undefined) {
        child.stdin?.write(opts.stdin);
        child.stdin?.end();
      }
    }

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new PhantomNotInstalledError());
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      const result: PhantomExecResult = { stdout, stderr, code: code ?? 0 };
      if (code !== 0 && !opts.allowFailure) {
        reject(
          new StackError(
            "PHANTOM_EXEC_FAILED",
            `phantom ${formatArgsForError(args)} failed (exit ${code}): ${stderr.trim() || stdout.trim()}`,
          ),
        );
        return;
      }
      resolvePromise(result);
    });
  });
}

export async function addSecret(key: string, value: string, cwd?: string): Promise<void> {
  await assertPhantomInstalled();
  await exec(["add", key, value], { cwd });
}

export async function removeSecret(key: string, cwd?: string): Promise<void> {
  await assertPhantomInstalled();
  await exec(["remove", key], { cwd, allowFailure: true });
}

export async function listSecrets(cwd?: string): Promise<string[]> {
  await assertPhantomInstalled();
  const { stdout } = await exec(["list"], { cwd, allowFailure: true });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function revealSecret(key: string, cwd?: string): Promise<string> {
  await assertPhantomInstalled();
  const { stdout } = await exec(["reveal", key], { cwd });
  return stdout.trim();
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
