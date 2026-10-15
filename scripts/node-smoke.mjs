#!/usr/bin/env node
// Node-compat smoke for the published entry points. Run after building:
//   bun run --filter '@ashlr/stack' build && bun run --filter 'ashlr-stack-mcp' build
//   node scripts/node-smoke.mjs
// Checks `stack --help` and an MCP initialize + tools/list + stack_scan
// against the bundled dist files under plain Node (no Bun on the child path).

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages/cli/dist/index.js");
const mcp = join(root, "packages/mcp/dist/server.js");
const mcpVersion = JSON.parse(readFileSync(join(root, "packages/mcp/package.json"), "utf8")).version;

function fail(msg) {
  console.error(`node-smoke: ${msg}`);
  process.exit(1);
}

const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
if (help.status !== 0 || !help.stdout.includes("stack")) fail(`stack --help failed:\n${help.stderr}`);
console.log("ok: stack --help");

const project = mkdtempSync(join(tmpdir(), "stack-node-smoke-"));
writeFileSync(join(project, "package.json"), JSON.stringify({ dependencies: { openai: "^4" } }));
const env = { ...process.env, STACK_NO_TELEMETRY: "1" };
delete env.STACK_BIN; // must resolve the @ashlr/stack dependency, not PATH
const child = spawn(process.execPath, [mcp], { cwd: project, env, stdio: ["pipe", "pipe", "inherit"] });
const timer = setTimeout(() => fail("MCP server timed out"), 20_000);

let buf = "";
const waiting = new Map();
child.stdout.on("data", (d) => {
  buf += d;
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
  }
});
let nextId = 0;
function request(method, params = {}) {
  const id = ++nextId;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => waiting.set(id, resolve));
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "node-smoke", version: "0" },
  });
  if (init.result?.serverInfo?.version !== mcpVersion)
    fail(`serverInfo.version ${init.result?.serverInfo?.version} != ${mcpVersion}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const list = await request("tools/list");
  const names = (list.result?.tools ?? []).map((t) => t.name);
  if (!names.includes("stack_scan")) fail(`tools/list missing stack_scan: ${names.join(",")}`);
  console.log(`ok: MCP initialize (v${mcpVersion}) + tools/list (${names.length} tools)`);
  const scan = await request("tools/call", { name: "stack_scan", arguments: {} });
  const text = scan.result?.content?.[0]?.text ?? "";
  if (scan.result?.isError || !JSON.parse(text).hits?.some((h) => h.provider === "openai"))
    fail(`stack_scan did not return JSON hits:\n${text}`);
  console.log("ok: stack_scan over MCP returns JSON");
} finally {
  clearTimeout(timer);
  child.kill();
  rmSync(project, { recursive: true, force: true });
}
