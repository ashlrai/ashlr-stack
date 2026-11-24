import { constants, accessSync, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { PhantomNotInstalledError, StackError } from "./errors.ts";

// Keep runtime, terminal and vault-location settings, plus Phantom's explicit
// vault unlock input. Never forward arbitrary provider credentials or loader hooks.
const ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERPROFILE",
  "SystemRoot",
  "APPDATA",
  "LOCALAPPDATA",
  "PATHEXT",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "NO_COLOR",
  "PHANTOM_VAULT_PASSPHRASE",
] as const;

export function phantomEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  if (process.platform === "win32") {
    // Windows environment names are case insensitive. Emit one canonical key.
    for (const key of ENV_KEYS) {
      const alias = Object.keys(source).find((name) => name.toLowerCase() === key.toLowerCase());
      if (alias !== undefined && source[alias] !== undefined) env[key] = source[alias];
    }
  }
  // Normalize PATH while the caller's cwd is still unambiguous: after spawn
  // applies the operation cwd, a relative entry would resolve inside that
  // project. Empty entries (an implicit current directory) are dropped, not
  // resolved anywhere.
  if (env.PATH !== undefined) {
    env.PATH = env.PATH.split(delimiter)
      .filter((entry) => entry !== "")
      .map((entry) => resolve(entry))
      .join(delimiter);
  }
  return env;
}

function phantomFileNames(): readonly string[] {
  if (process.platform !== "win32") return ["phantom"];
  // npm and the Windows shims are phantom.cmd, not phantom.exe. Prefer the
  // native image, then the shell shims CreateProcess can start.
  return ["phantom.exe", "phantom.cmd", "phantom.bat", "phantom"];
}

/** Resolve before spawn changes cwd; do not search an implicit current directory. */
export function resolvePhantomBinary(env: NodeJS.ProcessEnv, cwd = process.cwd()): string {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of phantomFileNames()) {
      const candidate = resolve(cwd, dir, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Missing or non-executable entries do not shadow a later installation.
      }
    }
  }
  throw new PhantomNotInstalledError();
}

const BAT_UNQUOTED = new Set("#$*+-./:?@_\\".split(""));

function batCharNeedsQuotes(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code < 32 || code === 127) return true;
  if (code >= 128) return false;
  const digit = char >= "0" && char <= "9";
  const upper = char >= "A" && char <= "Z";
  const lower = char >= "a" && char <= "z";
  return !(digit || upper || lower || BAT_UNQUOTED.has(char));
}

function quoteBatArg(arg: string): string {
  const quote = arg.length === 0 || arg.endsWith("\\") || [...arg].some(batCharNeedsQuotes);
  let out = quote ? '"' : "";
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes += 1;
      out += char;
      continue;
    }
    if (char === '"') {
      out += "\\".repeat(backslashes);
      out += '"';
    } else if (char === "%") {
      // Zero-length %cd:~,% so cmd expands nothing and cannot pair this %
      // with a later one. This is the batch-argument guard from Rust std.
      out += "%%cd:~,";
    }
    backslashes = 0;
    out += char;
  }
  if (quote) {
    out += "\\".repeat(backslashes);
    out += '"';
  }
  return out;
}

function rejectBatchText(value: string, label: string): void {
  if (value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    throw new StackError(
      "PHANTOM_EXEC_FAILED",
      `${label} contains a character cmd.exe cannot pass literally`,
    );
  }
}

/** Command line for a .cmd/.bat phantom. Arguments stay quoted; cmd.exe is not `shell: true`. */
export function windowsBatchCommandLine(script: string, args: readonly string[]): string {
  rejectBatchText(script, "phantom batch path");
  if (
    script.includes('"') ||
    script.includes("^") ||
    script.includes("%") ||
    script.endsWith("\\")
  ) {
    throw new StackError(
      "PHANTOM_EXEC_FAILED",
      "phantom batch path contains a quote, caret, percent, or a trailing backslash",
    );
  }
  for (const arg of args) rejectBatchText(arg, "phantom argument");
  const inner = [`"${script}"`, ...args.map(quoteBatArg)].join(" ");
  return `cmd.exe /e:ON /v:OFF /d /c "${inner}"`;
}

export function windowsBatchArgv(
  script: string,
  args: readonly string[],
): { file: string; args: string[] } {
  const line = windowsBatchCommandLine(script, args);
  const command = line.slice("cmd.exe /e:ON /v:OFF /d /c ".length);
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  const file = root ? `${root}\\System32\\cmd.exe` : "cmd.exe";
  return { file, args: ["/e:ON", "/v:OFF", "/d", "/c", command] };
}

export function phantomSpawnTarget(
  binary: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; windowsVerbatimArguments?: true } {
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(binary)) {
    return { ...windowsBatchArgv(binary, args), windowsVerbatimArguments: true };
  }
  return { file: binary, args: [...args] };
}
