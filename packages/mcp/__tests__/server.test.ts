/**
 * Smoke tests for the compiled MCP server (dist/server.js).
 *
 * Spawns the server once via the MCP SDK StdioClientTransport, sends
 * tools/list, and validates the response shape. No real network or Phantom
 * calls are made — tools/list is fully self-contained inside the server.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_PATH = join(import.meta.dir, "..", "dist", "server.js");

// Expected tool names as defined in server.ts TOOLS array (19 tools).
const EXPECTED_TOOL_NAMES = [
  "stack_init",
  "stack_import",
  "stack_scan",
  "stack_add",
  "stack_remove",
  "stack_list",
  "stack_info",
  "stack_status",
  "stack_env_show",
  "stack_env_diff",
  "stack_doctor",
  "stack_sync",
  "stack_providers",
  "stack_projects_list",
  "stack_deps",
  "stack_templates_list",
  "stack_upgrade",
  "stack_recommend",
  "stack_apply",
];

let client: Client;
let transport: StdioClientTransport;
let serverProcess: ChildProcess | undefined;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
  });

  // Capture the underlying process so we can SIGKILL on teardown failure.
  // StdioClientTransport exposes the process on ._process after start.
  client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(transport);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverProcess = (transport as unknown as { _process?: ChildProcess })._process;
}, 10_000);

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // best-effort — fall through to SIGKILL
  }
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
});

describe("MCP server smoke tests", () => {
  test("tools/list returns a non-empty tools array", async () => {
    const response = await client.listTools();
    expect(Array.isArray(response.tools)).toBe(true);
    expect(response.tools.length).toBeGreaterThan(0);
  });

  test("tools/list returns the expected tool count", async () => {
    const response = await client.listTools();
    // Report actual count — plan says 20, description says 19.
    expect(response.tools.length).toBe(EXPECTED_TOOL_NAMES.length);
  });

  test("each expected tool name is present in tools/list", async () => {
    const response = await client.listTools();
    const names = response.tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(expected);
    }
  });

  test("every tool has name, description, and inputSchema", async () => {
    const response = await client.listTools();
    for (const tool of response.tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema).toBe("object");
    }
  });

  test("inputSchema for every tool has type: object", async () => {
    const response = await client.listTools();
    for (const tool of response.tools) {
      expect((tool.inputSchema as { type?: string }).type).toBe("object");
    }
  });

  test("tools with required fields have non-empty required array", async () => {
    const response = await client.listTools();
    const toolsWithRequired = response.tools.filter(
      (t) =>
        (t.inputSchema as { required?: string[] }).required !== undefined,
    );
    for (const tool of toolsWithRequired) {
      const required = (tool.inputSchema as { required?: string[] }).required!;
      expect(Array.isArray(required)).toBe(true);
      expect(required.length).toBeGreaterThan(0);
    }
  });
});
