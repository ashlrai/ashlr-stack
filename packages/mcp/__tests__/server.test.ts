/**
 * Smoke tests for the compiled MCP server (dist/server.js).
 *
 * Spawns the server once via the MCP SDK StdioClientTransport, sends
 * tools/list, and validates the response shape. No real network or Phantom
 * calls are made — tools/list is fully self-contained inside the server.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import packageManifest from "../package.json";

const SERVER_PATH = join(import.meta.dir, "..", "dist", "server.js");
// The server spawns the `stack` bin of its @ashlr/stack dependency (the
// workspace's packages/cli), so tool calls need that dist built too.
const CLI_DIR = join(import.meta.dir, "..", "..", "cli");

// Expected tool names as defined in src/tools.ts TOOLS array (19 tools).
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
  // CI (and a fresh clone) may not have run `bun run build` yet, so the
  // compiled server.js is missing. Build on demand so the test is self
  // contained.
  for (const [dist, pkgDir] of [
    [SERVER_PATH, join(import.meta.dir, "..")],
    [join(CLI_DIR, "dist", "index.js"), CLI_DIR],
  ]) {
    if (existsSync(dist)) continue;
    const build = spawnSync("bun", ["run", "build"], { cwd: pkgDir, stdio: "inherit" });
    if (build.status !== 0) {
      throw new Error(`Build of ${pkgDir} failed (exit ${build.status}) — cannot run tests.`);
    }
  }

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
  test("initialize reports the source package version", () => {
    expect(client.getServerVersion()?.version).toBe(packageManifest.version);
  });

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

describe("MCP server runtime", () => {
  test("stack_scan runs the bundled CLI and returns JSON, not a TTY hint", async () => {
    // The server was spawned without STACK_BIN (StdioClientTransport passes a
    // minimal env), so this also proves the @ashlr/stack dependency resolves.
    const project = mkdtempSync(join(tmpdir(), "stack-mcp-scan-"));
    try {
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.45.0" } }),
      );
      const result = (await client.callTool({
        name: "stack_scan",
        arguments: { cwd: project, path: "." },
      })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
      const text = result.content[0]?.text ?? "";
      expect(result.isError).toBeFalsy();
      expect(text).not.toContain("no TTY detected");
      expect(text).not.toContain("\u001b");
      const parsed = JSON.parse(text) as { hits: Array<{ provider: string }> };
      expect(parsed.hits.map((h) => h.provider)).toContain("supabase");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }, 20_000);

  test.each([
    {
      label: "nonexistent path",
      args: { path: "stack-mcp-scan-missing-xyz" },
      needle: "stack-mcp-scan-missing-xyz",
    },
    {
      label: "invalid confidence",
      args: { confidence: "hgih" },
      needle: 'Unknown confidence "hgih"',
    },
  ])("stack_scan reports $label as an error, not empty hits", async ({ args, needle }) => {
    const result = (await client.callTool({ name: "stack_scan", arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content[0]?.text ?? "";
    expect(result.isError).toBe(true);
    expect(text).toContain(needle);
    expect(text).not.toContain('"hits"');
  }, 20_000);

  test.each([
    { label: "a flag as the service", name: "stack_remove", args: { service: "--all" } },
    { label: "a missing service", name: "stack_add", args: {} },
  ])("refuses $label before running the CLI", async ({ name, args }) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content[0]?.text ?? "";
    expect(result.isError).toBe(true);
    expect(text.startsWith(`${name}: `)).toBe(true);
    expect(text).not.toContain("undefined");
  }, 20_000);
});

describe("MCP CLI completion", () => {
  test.each([
    { label: "completed success", script: "echo inert; exit 0", isError: false },
    { label: "completed failure", script: "echo inert; exit 9", isError: true },
    { label: "signal termination", script: "echo inert; kill -TERM $$", isError: true },
  ])("$label is reported truthfully", async ({ script, isError }) => {
    const root = mkdtempSync(join(tmpdir(), "stack-mcp-completion-"));
    const fake = join(root, "stack");
    writeFileSync(fake, `#!/bin/sh\n${script}\n`);
    chmodSync(fake, 0o700);
    const fixtureClient = new Client({ name: "inert-completion-test", version: "0.0.1" });
    const fixtureTransport = new StdioClientTransport({
      command: "node", args: [SERVER_PATH],
      env: {
        STACK_BIN: fake, HOME: root, TMPDIR: root,
        PATH: process.env.PATH ?? "",
      },
    });
    try {
      await fixtureClient.connect(fixtureTransport);
      const result = await fixtureClient.callTool({ name: "stack_providers", arguments: {} });
      expect(result.isError).toBe(isError);
      expect(result.content).toEqual([{ type: "text", text: "inert" }]);
    } finally {
      await fixtureClient.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
