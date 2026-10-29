import { constants, accessSync, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { PhantomNotInstalledError } from "./errors.ts";

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

/** Resolve before spawn changes cwd; do not search an implicit current directory. */
export function resolvePhantomBinary(env: NodeJS.ProcessEnv, cwd = process.cwd()): string {
  const name = process.platform === "win32" ? "phantom.exe" : "phantom";
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = resolve(cwd, dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Missing or non-executable entries do not shadow a later installation.
    }
  }
  throw new PhantomNotInstalledError();
}
