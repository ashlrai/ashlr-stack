/**
 * Locate the `stack` CLI and this package's version at runtime.
 *
 * Both work from `src/` under Bun and from the bundled `dist/server.js` under
 * Node: the CLI is found through Node module resolution at runtime (never
 * inlined by the bundler), and package.json is read from disk one directory
 * above this file, which holds for both layouts.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface StackCommand {
  /** Executable to spawn. */
  command: string;
  /** Arguments to put before the `stack` subcommand argv. */
  prefixArgs: string[];
  /** Where the command came from, for error hints. */
  source: "env" | "package" | "path";
}

// Held in a variable so bundlers leave the runtime resolution alone.
const CLI_PACKAGE_JSON = ["@ashlr", "stack", "package.json"].join("/");

/** Default resolver: find @ashlr/stack's package.json next to this module. */
export function resolveCliPackageJson(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve(CLI_PACKAGE_JSON);
  } catch {
    return undefined;
  }
}

/** Absolute path of the `stack` bin declared by @ashlr/stack, if installed. */
export function cliBinFromPackageJson(pkgJsonPath: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.stack;
    if (!rel) return undefined;
    const abs = resolve(dirname(pkgJsonPath), rel);
    return existsSync(abs) ? abs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolution order:
 *   1. STACK_BIN env var (explicit override always wins),
 *   2. the @ashlr/stack dependency's bin, run with the current runtime
 *      (process.execPath) so it needs no PATH entry or exec bit,
 *   3. `stack` on PATH.
 */
export function resolveStackCommand(
  env: NodeJS.ProcessEnv = process.env,
  findPackageJson: () => string | undefined = resolveCliPackageJson,
): StackCommand {
  if (env.STACK_BIN) return { command: env.STACK_BIN, prefixArgs: [], source: "env" };
  const pkgJson = findPackageJson();
  const bin = pkgJson ? cliBinFromPackageJson(pkgJson) : undefined;
  if (bin) {
    return /\.[cm]?[jt]s$/.test(bin)
      ? { command: process.execPath, prefixArgs: [bin], source: "package" }
      : { command: bin, prefixArgs: [], source: "package" };
  }
  return { command: "stack", prefixArgs: [], source: "path" };
}

/** Version from this package's package.json (src/ and dist/ both sit one level down). */
export function readServerVersion(moduleUrl: string = import.meta.url): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(moduleUrl)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string; version?: string };
    if (pkg.name === "ashlr-stack-mcp" && pkg.version) return pkg.version;
  } catch {
    // fall through
  }
  return "0.0.0";
}
