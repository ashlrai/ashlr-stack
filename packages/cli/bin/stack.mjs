#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { binaryTarget, selectLaunch } from "./binary-target.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = binaryTarget(process.platform, process.arch);
const nativePath = target ? join(root, "binaries", target.file) : "";
const jsPath = join(root, "dist", "index.js");
const decided = selectLaunch({
  platform: process.platform,
  arch: process.arch,
  nativeExists: nativePath !== "" && existsSync(nativePath),
  jsExists: existsSync(jsPath),
});

if (decided.kind === "error") {
  process.stderr.write(`stack: ${decided.message}\n`);
  process.exit(1);
}

const command = decided.kind === "native" ? nativePath : process.execPath;
const args =
  decided.kind === "native" ? process.argv.slice(2) : [jsPath, ...process.argv.slice(2)];
const child = spawn(command, args, { stdio: "inherit", windowsHide: true, shell: false });
child.on("error", (err) => {
  process.stderr.write(`stack: could not start ${command}: ${err.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
