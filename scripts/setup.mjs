#!/usr/bin/env node
// One-command development setup. Idempotent and non-interactive.
// macOS, Windows, and Linux. `scripts/setup.sh` and `scripts/setup.ps1` call this.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function supportedPlatform(platform = process.platform) {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

/** Argv that installs Bun when it is missing. Not run by the tests. */
export function bunInstallArgv(platform = process.platform) {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://bun.sh/install.ps1 | iex",
      ],
    };
  }
  return {
    command: "bash",
    args: ["-lc", "curl -fsSL https://bun.sh/install | bash"],
  };
}

function fail(message) {
  process.stderr.write(`setup: ${message}\n`);
  process.exit(1);
}

function commandExists(name) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const found = spawnSync(finder, [name], { stdio: "ignore" });
  return found.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  if (!supportedPlatform()) {
    fail(`this script supports macOS, Windows, and Linux. This system is ${process.platform}.`);
  }
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    fail(`Node.js 20 or newer is required. Found ${process.version}.`);
  }
  if (!commandExists("git")) fail("git is required.");

  if (!commandExists("bun")) {
    const install = bunInstallArgv();
    process.stdout.write("setup: installing Bun\n");
    run(install.command, install.args);
    const bunBin = join(process.env.USERPROFILE || process.env.HOME || "", ".bun", "bin");
    const current = process.env.PATH ?? process.env.Path ?? "";
    process.env.PATH = `${bunBin}${delimiter}${current}`;
    if (process.platform === "win32") process.env.Path = process.env.PATH;
  }
  if (!commandExists("bun")) fail("Bun is not on PATH after install.");

  run("bun", ["install", "--frozen-lockfile"]);

  const smokeHome = mkdtempSync(join(tmpdir(), "stack-setup-"));
  try {
    const result = spawnSync("bun", ["packages/cli/src/index.ts", "providers", "--json"], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        HOME: smokeHome,
        USERPROFILE: smokeHome,
        STACK_TELEMETRY: "0",
        STACK_NO_UPDATE_CHECK: "1",
        NO_COLOR: "1",
      },
    });
    if (result.status !== 0) {
      process.stderr.write(result.stderr ?? "");
      process.exit(result.status ?? 1);
    }
    const report = JSON.parse(result.stdout);
    if (report.schema !== "ashlr.stack.providers/v1") process.exit(1);
    if (!Array.isArray(report.providers) || report.providers.length === 0) process.exit(1);
    if (!Array.isArray(report.unavailable) || report.unavailable.length !== 0) process.exit(1);
  } finally {
    rmSync(smokeHome, { recursive: true, force: true });
  }

  process.stdout.write(
    "setup: ready (stack providers --json, schema ashlr.stack.providers/v1).\n",
  );
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) main();
