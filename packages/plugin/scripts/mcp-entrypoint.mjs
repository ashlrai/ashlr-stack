#!/usr/bin/env node
// Start the Stack MCP server. Prefer a global binary. Fall back to this checkout.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "mcp", "src", "server.ts");

function onPath(name) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(finder, [name], { stdio: "ignore" }).status === 0;
}

function launch(command, args) {
  const shell = process.platform === "win32" && !command.includes("\\") && !command.includes("/");
  const child = spawn(command, args, { stdio: "inherit", shell });
  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", () => process.exit(127));
}

function main() {
  if (onPath("ashlr-stack-mcp")) {
    launch("ashlr-stack-mcp", []);
    return;
  }
  if (existsSync(source)) {
    launch("bun", [source]);
    return;
  }
  process.stderr.write(
    "ashlr-stack MCP: could not find ashlr-stack-mcp on PATH or the monorepo source.\n",
  );
  process.stderr.write("Install: npm i -g ashlr-stack-mcp\n");
  process.exit(127);
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) main();
