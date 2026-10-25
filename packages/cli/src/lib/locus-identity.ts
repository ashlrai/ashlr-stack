import { spawnSync } from "node:child_process";

/**
 * `stack exec --as <alias>`: read which Locus binding is pinned, so Stack can
 * refuse before Phantom or the wrapped command starts when it is the wrong
 * account. Only `binding_alias`, `seal_ok` and `frozen` are read from
 * `locus whoami --json` (locus-core `Whoami`; `binding_alias` and `seal_ok`
 * since the first release, `frozen` since v0.1.1). Anything else, including
 * an older shape without `frozen`, is treated as unknown and refused.
 */

/** Alias characters Stack will accept from `--as` and from Locus. */
const ALIAS_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function isSafeAlias(value: unknown): value is string {
  return typeof value === "string" && ALIAS_RE.test(value);
}

/** Echo an alias back only when it is plainly an alias. */
export function aliasLabel(value: string): string {
  return isSafeAlias(value) ? value : "<invalid alias>";
}

export const LOCUS_PROBE_TIMEOUT_MS = 5_000;
export const LOCUS_PROBE_MAX_STDOUT = 64 * 1024;

/**
 * Variables the probe keeps. Everything else (tokens, keys, phm_ values) is
 * dropped. LOCUS_HOME and LOCUS_SESSION_ID are kept because they decide which
 * Locus store and session `whoami` reports; without them the answer could
 * describe a different identity than the one the command would act as.
 */
const PROBE_ENV_KEYS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LOCUS_HOME",
  "LOCUS_SESSION_ID",
];

export function probeEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PROBE_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value !== "") env[key] = value;
  }
  return env;
}

export type PinnedAlias =
  | { kind: "pinned"; alias: string }
  | { kind: "frozen"; alias: string }
  | { kind: "no_pin" }
  | { kind: "not_installed" }
  | { kind: "unreadable" };

/** Interpret `locus whoami --json` stdout. Unconfirmed shapes are unreadable. */
export function parseWhoami(stdout: string): PinnedAlias {
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch {
    return { kind: "unreadable" };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return { kind: "unreadable" };
  const w = doc as Record<string, unknown>;
  if (!isSafeAlias(w.binding_alias)) return { kind: "unreadable" };
  if (typeof w.frozen !== "boolean" || typeof w.seal_ok !== "boolean") {
    return { kind: "unreadable" };
  }
  if (w.frozen || !w.seal_ok) return { kind: "frozen", alias: w.binding_alias };
  return { kind: "pinned", alias: w.binding_alias };
}

export interface ProbeResult {
  error?: { code?: string } | Error;
  status: number | null;
  stdout: string;
}

export type ProbeRunner = (env: Record<string, string>) => ProbeResult;

const defaultRunner: ProbeRunner = (env) => {
  const r = spawnSync("locus", ["whoami", "--json"], {
    env,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: LOCUS_PROBE_TIMEOUT_MS,
    maxBuffer: LOCUS_PROBE_MAX_STDOUT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return { error: r.error, status: r.status, stdout: typeof r.stdout === "string" ? r.stdout : "" };
};

export function readPinnedAlias(
  runner: ProbeRunner = defaultRunner,
  source: NodeJS.ProcessEnv = process.env,
): PinnedAlias {
  let r: ProbeResult;
  try {
    r = runner(probeEnv(source));
  } catch {
    return { kind: "unreadable" };
  }
  if (r.error) {
    return (r.error as { code?: string }).code === "ENOENT"
      ? { kind: "not_installed" }
      : { kind: "unreadable" };
  }
  // whoami exits non-zero when nothing is pinned (or the pin cannot be read).
  if (r.status !== 0) return { kind: "no_pin" };
  if (r.stdout.length > LOCUS_PROBE_MAX_STDOUT) return { kind: "unreadable" };
  return parseWhoami(r.stdout);
}

/** null when `pinned` satisfies `expected`, else the refusal message. */
export function expectRefusal(expected: string, pinned: PinnedAlias): string | null {
  const want = aliasLabel(expected);
  if (!isSafeAlias(expected)) {
    return `--as needs a Locus binding alias (letters, digits, '.', '_' or '-'); nothing was run.`;
  }
  const hint = `Run: locus enter ${want}`;
  switch (pinned.kind) {
    case "pinned":
      if (pinned.alias === expected) return null;
      return `pin_mismatch: expected Locus binding '${want}' but '${pinned.alias}' is pinned; nothing was run. ${hint}`;
    case "frozen":
      return `pin_frozen: the pinned Locus binding '${pinned.alias}' is frozen or its seal is not ok; nothing was run. Run: locus leave, then locus enter ${want}`;
    case "no_pin":
      return `pin_missing: expected Locus binding '${want}' but no binding is pinned; nothing was run. ${hint}`;
    case "not_installed":
      return `locus_missing: --as needs Locus on PATH to check the pinned binding; nothing was run. Install Locus, then ${hint.toLowerCase()}`;
    case "unreadable":
      return `pin_unknown: could not confirm the pinned Locus binding from \`locus whoami --json\`; nothing was run. Update Locus, then ${hint.toLowerCase()}`;
  }
}

/**
 * Split `stack exec` argv. `--as` is read only before `--`, and `--as` without
 * `--` is a usage error so a command is never mistaken for an alias.
 */
export function parseExecArgv(
  rawArgs: string[],
): { ok: true; as?: string; forwarded: string[] } | { ok: false; message: string } {
  const sep = rawArgs.indexOf("--");
  const head = sep >= 0 ? rawArgs.slice(0, sep) : rawArgs;
  let as: string | undefined;
  let seen = false;
  for (let i = 0; i < head.length; i++) {
    const tok = head[i] as string;
    if (tok === "--as") {
      seen = true;
      as = head[i + 1];
      i++;
    } else if (tok.startsWith("--as=")) {
      seen = true;
      as = tok.slice("--as=".length);
    }
  }
  if (seen) {
    if (sep < 0 || as === undefined || as === "") {
      return { ok: false, message: "Usage: stack exec --as <alias> -- <command>" };
    }
    return { ok: true, as, forwarded: rawArgs.slice(sep + 1) };
  }
  return { ok: true, forwarded: sep >= 0 ? rawArgs.slice(sep + 1) : rawArgs };
}
