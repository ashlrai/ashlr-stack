/**
 * End-to-end seam test: MCP `stack_list` / `stack_deps` / `stack_providers`
 * with `json: true` reach the real CLI (run from source) and return the
 * `--json` contracts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_SRC = join(import.meta.dir, "..", "src", "server.ts");
const CLI_SRC = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

let dir: string;
let client: Client;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "stack-mcp-list-"));
  const project = join(dir, "proj");
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  for (const d of [project, home, bin]) mkdirSync(d, { recursive: true });
  writeFileSync(
    join(project, ".stack.toml"),
    '[stack]\nversion = "1"\n\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n',
  );
  writeFileSync(join(project, ".stack.local.toml"), '[stack]\nproject_id = "stk_mcp00001"\n');
  const launcher = join(bin, "stack");
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${CLI_SRC}" "$@"\n`);
  chmodSync(launcher, 0o755);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_SRC],
    cwd: project,
    env: {
      // No phantom on PATH: keeps the result independent of the host.
      PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      HOME: home,
      STACK_BIN: launcher,
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
    },
  });
  client = new Client({ name: "list-json-test", version: "0.0.1" });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // best-effort
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP structured list tools", () => {
  function text(res: { content: unknown }): string {
    return (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  }

  test("stack_list json: true returns the stack list --json contract", async () => {
    const res = await client.callTool({ name: "stack_list", arguments: { json: true } });
    expect(res.isError).toBe(false);
    const report = JSON.parse(text(res));
    expect(report.schema).toBe("ashlr.stack.list/v1");
    expect(report.project_id).toBe("stk_mcp00001");
    expect(report.services.map((s: { name: string }) => s.name)).toEqual(["openai"]);
  }, 15_000);

  test("stack_deps json: true returns the stack deps --json contract", async () => {
    const res = await client.callTool({ name: "stack_deps", arguments: { json: true } });
    expect(res.isError).toBe(false);
    const report = JSON.parse(text(res));
    expect(report.schema).toBe("ashlr.stack.deps/v1");
    expect(report.categories[0].services[0].name).toBe("openai");
  }, 15_000);

  test("stack_providers json: true returns the stack providers --json contract", async () => {
    const res = await client.callTool({ name: "stack_providers", arguments: { json: true } });
    expect(res.isError).toBe(false);
    const report = JSON.parse(text(res));
    expect(report.schema).toBe("ashlr.stack.providers/v1");
    expect(report.providers.length).toBe(report.total);
  }, 15_000);

  test("default stack_list call keeps human output", async () => {
    const res = await client.callTool({ name: "stack_list", arguments: {} });
    expect(text(res)).toContain("(1 services)");
  }, 15_000);
});
