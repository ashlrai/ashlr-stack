import { constants, accessSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { PhantomNotInstalledError } from "./errors.ts";

function pathApi(platform: NodeJS.Platform) {
  return platform === "win32" ? nodePath.win32 : nodePath.posix;
}

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
    const pathApiForHost = pathApi(process.platform);
    env.PATH = env.PATH.split(pathApiForHost.delimiter)
      .filter((entry) => entry !== "")
      .map((entry) => pathApiForHost.resolve(entry))
      .join(pathApiForHost.delimiter);
  }
  return env;
}

/** Names PATHEXT would try for `phantom` on Windows, in PATHEXT order. */
export function phantomBinaryNames(
  platform: NodeJS.Platform,
  pathext = ".COM;.EXE;.BAT;.CMD",
): string[] {
  if (platform !== "win32") return ["phantom"];
  const names: string[] = [];
  for (const raw of pathext.split(";")) {
    const ext = raw.trim();
    if (!ext) continue;
    const suffix = ext.startsWith(".") ? ext : `.${ext}`;
    names.push(`phantom${suffix}`);
  }
  return names.length > 0 ? names : ["phantom.exe"];
}

/** `.cmd` and `.bat` shims do not start with CreateProcess. They need a shell. */
export function commandNeedsWindowsShell(
  file: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(file);
}

/**
 * Absolute paths PATHEXT lookup would try. Windows uses `path.win32` (backslash
 * and `;`) even when this function is evaluated on another operating system.
 */
export function phantomLookupPaths(
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  const paths = pathApi(platform);
  const names = phantomBinaryNames(platform, env.PATHEXT);
  const out: string[] = [];
  for (const dir of (env.PATH ?? "").split(paths.delimiter)) {
    if (!dir) continue;
    for (const name of names) out.push(paths.resolve(cwd, dir, name));
  }
  return out;
}

/** Resolve before spawn changes cwd; do not search an implicit current directory. */
export function resolvePhantomBinary(
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): string {
  for (const candidate of phantomLookupPaths(env, cwd, platform)) {
    try {
      if (!statSync(candidate).isFile()) continue;
      // Windows script shims have no Unix execute bit. PATHEXT is the lookup.
      if (platform !== "win32") accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Missing or non-executable entries do not shadow a later installation.
    }
  }
  throw new PhantomNotInstalledError();
}
