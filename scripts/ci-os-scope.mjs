import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

// Path gate for the Windows and macOS legs. Docs-only and other unrelated
// diffs skip those runners. The categories below are the ones that can behave
// differently per OS: path handling, shell scripts, installers, manifests,
// lockfiles, and this workflow (including the scripts it runs).

const PATH_MODULES = new Set([
  "packages/cli/src/commands/open.ts",
  "packages/cli/src/lib/doctor-fix.ts",
  "packages/cli/src/lib/doctor-install.ts",
  "packages/mcp/src/cwd.ts",
  "packages/mcp/src/stack-bin.ts",
]);

export function isOsSensitive(path) {
  const name = path.split("/").at(-1) ?? "";
  if (/\.(?:sh|ps1|cmd|bat)$/i.test(name)) return true;
  if (name === "package.json" || name === "bun.lock" || name === "bun.lockb" || name === "package-lock.json") {
    return true;
  }
  if (path.startsWith(".github/workflows/")) return true;
  if (path === ".github/homebrew-formula.template.rb") return true;
  if (path.startsWith("scripts/ci-os") || path.startsWith("scripts/ci-install-smoke")) return true;
  if (PATH_MODULES.has(path)) return true;
  return /(?:^|\/)[^/]*path[^/]*\.(?:ts|tsx|mjs|js)$/i.test(path);
}

export function runOsLegs(event, paths) {
  if (event === "schedule" || event === "workflow_dispatch") return true;
  if (paths == null) return true;
  return paths.some(isOsSensitive);
}

function changedPaths(base) {
  if (!base) return null;
  const diff = spawnSync("git", ["diff", "--name-only", "-z", `${base}...HEAD`], { encoding: "utf8" });
  if (diff.status !== 0) return null;
  return diff.stdout.split("\0").filter(Boolean);
}

function main() {
  const event = process.env.EVENT_NAME ?? "";
  const scheduled = event === "schedule" || event === "workflow_dispatch";
  const paths = scheduled ? null : changedPaths(process.env.BASE_SHA ?? "");
  const value = runOsLegs(event, paths) ? "true" : "false";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run_os=${value}\n`);
  console.log(`run_os=${value}`);
}

if (process.argv[1]?.endsWith("ci-os-scope.mjs")) main();
