import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "npm" | "yarn";

/**
 * Detect the PM used in a project by inspecting lockfiles. Walks up from
 * `cwd` (default: process.cwd()) to find the nearest project root (dir
 * containing package.json). Falls back to "npm" if nothing is found.
 *
 * Lockfile precedence:
 *   bun.lock > bun.lockb > pnpm-lock.yaml > yarn.lock > package-lock.json
 */
export async function detectPackageManager(cwd?: string): Promise<PackageManager> {
  const start = cwd ?? process.cwd();

  // Walk up directory tree until we find a package.json or hit root.
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "bun.lock"))) return "bun";
    if (existsSync(join(dir, "bun.lockb"))) return "bun";
    if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(dir, "yarn.lock"))) return "yarn";
    if (existsSync(join(dir, "package-lock.json"))) return "npm";

    // Stop walking if we found a package.json (this is the project root).
    if (existsSync(join(dir, "package.json"))) break;

    const parent = dirname(dir);
    // Hit filesystem root — give up.
    if (parent === dir) break;
    dir = parent;
  }

  return "npm";
}

/**
 * The install command argv for a given PM + packages. Examples:
 *   bun:  ["bun", "add", "@supabase/supabase-js"]
 *   pnpm: ["pnpm", "add", "@supabase/supabase-js"]
 *   npm:  ["npm", "install", "@supabase/supabase-js"]
 *   yarn: ["yarn", "add", "@supabase/supabase-js"]
 */
export function installCommand(pm: PackageManager, packages: string[]): string[] {
  switch (pm) {
    case "bun":
      return ["bun", "add", ...packages];
    case "pnpm":
      return ["pnpm", "add", ...packages];
    case "yarn":
      return ["yarn", "add", ...packages];
    case "npm":
      return ["npm", "install", ...packages];
  }
}
