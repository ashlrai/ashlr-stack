#!/usr/bin/env node
// Typecheck and test workspaces changed since origin/main, including uncommitted work.
// scripts/fast-check.sh and scripts/fast-check.ps1 call this.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return spawnSync("git", args, { cwd: root });
}

function main() {
  const start = Date.now();
  const seconds = () => Math.round((Date.now() - start) / 1000);
  const diff = git(["diff", "--name-only", "--no-renames", "-z", "origin/main", "--", "packages/"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", "packages/"]);
  if (diff.status !== 0 || untracked.status !== 0) {
    process.stdout.write(
      `FAIL changed packages (cannot compare with origin/main)\nTotal: ${seconds()}s\n`,
    );
    process.exit(1);
  }
  const names = Buffer.concat([diff.stdout ?? Buffer.alloc(0), untracked.stdout ?? Buffer.alloc(0)])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const packages = [];
  for (const path of names) {
    const parts = path.split("/");
    if (parts.length < 3 || parts[0] !== "packages") continue;
    const name = parts[1];
    if (!name || packages.includes(name)) continue;
    if (existsSync(join(root, "packages", name, "package.json"))) packages.push(name);
  }

  let failed = 0;
  const runStep = (label, command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
    if (result.status === 0) {
      process.stdout.write(`PASS ${label}\n`);
      return;
    }
    process.stdout.write(`FAIL ${label}\n`);
    process.stdout.write(result.stdout ?? "");
    process.stdout.write(result.stderr ?? "");
    failed = 1;
  };

  for (const name of packages) {
    runStep(
      `${name} typecheck`,
      "bunx",
      ["tsc", "--noEmit", "-p", "tsconfig.json"],
      join(root, "packages", name),
    );
    runStep(`${name} test`, "bun", ["test", "--pass-with-no-tests", `packages/${name}`], root);
  }
  if (packages.length === 0) process.stdout.write("PASS no changed packages\n");
  process.stdout.write(`Total: ${seconds()}s\n`);
  process.exit(failed);
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) main();
