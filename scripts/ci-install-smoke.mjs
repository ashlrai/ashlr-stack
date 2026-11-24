import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { homedir } from "node:os";

export function compileTarget(platform, arch) {
  const cpu = arch === "arm64" || arch === "aarch64" ? "arm64" : arch === "x64" || arch === "x86_64" ? "x64" : "";
  if (!cpu) return "";
  if (platform === "linux") return `bun-linux-${cpu}`;
  if (platform === "darwin") return `bun-darwin-${cpu}`;
  if (platform === "win32") return `bun-windows-${cpu}`;
  return "";
}

export function commitInstallPath(platform, home) {
  if (platform === "win32") return join(home, ".local", "bin", "stack.exe");
  return join(home, ".ashlr", "bin", "stack");
}

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function withPath(dirs) {
  const key = process.platform === "win32" ? "Path" : "PATH";
  const current = process.env[key] ?? process.env.PATH ?? "";
  const path = [...dirs, current].filter(Boolean).join(delimiter);
  return { ...process.env, PATH: path, Path: path };
}

function assertProviders(env) {
  run("stack", ["providers", "--json"], env);
}

function main() {
const mode = process.argv[2];
const home = homedir();
if (mode === "commit") {
  const target = compileTarget(process.platform, process.arch);
  if (!target) {
    console.error(`::error::no compile target for ${process.platform}/${process.arch}`);
    process.exit(1);
  }
  const outfile = commitInstallPath(process.platform, home);
  mkdirSync(dirname(outfile), { recursive: true });
  run("bun", ["build", "packages/cli/src/index.ts", "--compile", `--target=${target}`, `--outfile=${outfile}`]);
  if (process.platform !== "win32") chmodSync(outfile, 0o755);
  assertProviders(withPath([dirname(outfile)]));
} else if (mode === "release") {
  if (process.platform === "win32") run("pwsh", ["-NoProfile", "-File", "scripts/install.ps1"]);
  else run("bash", ["scripts/install.sh"]);
  const dirs = process.platform === "win32"
    ? [join(home, ".local", "bin"), join(home, ".bun", "bin"), join(process.env.APPDATA ?? "", "npm"), join(process.env.LOCALAPPDATA ?? "", "Programs", "ashlr-stack", "bin")]
    : [join(home, ".ashlr", "bin"), join(home, ".bun", "bin"), join(home, ".local", "bin")];
  assertProviders(withPath(dirs));
} else {
  console.error("::error::usage: ci-install-smoke.mjs commit|release");
  process.exit(1);
}
}

if (process.argv[1]?.endsWith("ci-install-smoke.mjs")) main();
