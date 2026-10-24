/**
 * End-to-end seam test: MCP `stack_projects_list` / `stack_templates_list`
 * with `json: true` reach the real CLI (run from source) and return the
 * `--json` contracts instead of the decorated human list.
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
  dir = mkdtempSync(join(tmpdir(), "stack-mcp-registry-"));
  const project = join(dir, "proj");
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  for (const d of [project, home, bin]) mkdirSync(d, { recursive: true });
  const launcher = join(bin, "stack");
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${CLI_SRC}" "$@"\n`);
  chmodSync(launcher, 0o755);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_SRC],
    cwd: project,
    env: {
      PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      HOME: home,
      STACK_REGISTRY_DIR: join(dir, "registry"),
      STACK_BIN: launcher,
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
    },
  });
  client = new Client({ name: "registry-json-test", version: "0.0.1" });
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

function text(res: { content: unknown }): string {
  return (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
}

describe("MCP registry and template tools", () => {
  test("stack_projects_list json: true returns ashlr.stack.projects/v1", async () => {
    const res = await client.callTool({ name: "stack_projects_list", arguments: { json: true } });
    expect(res.isError).toBe(false);
    expect(JSON.parse(text(res))).toEqual({
      schema: "ashlr.stack.projects/v1",
      total: 0,
      projects: [],
    });
  }, 15_000);

  test("stack_templates_list json: true returns ashlr.stack.templates/v1", async () => {
    const res = await client.callTool({ name: "stack_templates_list", arguments: { json: true } });
    expect(res.isError).toBe(false);
    const report = JSON.parse(text(res));
    expect(report.schema).toBe("ashlr.stack.templates/v1");
    expect(report.total).toBeGreaterThan(0);
    for (const t of report.templates) expect(Array.isArray(t.services)).toBe(true);
  }, 15_000);

  test("default stack_templates_list call keeps human output", async () => {
    const res = await client.callTool({ name: "stack_templates_list", arguments: {} });
    expect(text(res)).toContain("stack templates");
    expect(() => JSON.parse(text(res))).toThrow();
  }, 15_000);
});
