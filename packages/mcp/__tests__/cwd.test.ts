/**
 * Project-scoped tools take an optional absolute `cwd` so an MCP server started
 * outside the project (Claude Desktop, a global Cursor config) can still
 * target it. Unit tests cover argv/cwd planning and validation; the stdio
 * test starts the real server in directory A and drives a project in B.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { acceptsCwd, planToolCall, resolveToolCwd } from "../src/cwd.ts";
import { CWD_INPUT, TOOLS } from "../src/tools.ts";

const SERVER_SRC = join(import.meta.dir, "..", "src", "server.ts");
const CLI_SRC = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

const PROJECT_SCOPED = [
  "stack_init",
  "stack_import",
  "stack_scan",
  "stack_add",
  "stack_remove",
  "stack_list",
  "stack_info",
  "stack_env_show",
  "stack_env_diff",
  "stack_doctor",
  "stack_sync",
  "stack_deps",
  "stack_recommend",
  "stack_apply",
];

function tool(name: string) {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`missing tool ${name}`);
  return def;
}

let root: string;
let serverDir: string; // A: where the MCP server runs
let projectDir: string; // B: the project the agent targets
let initDir: string; // C: an empty directory stack_init scaffolds into
let client: Client;

const SERVICE_TOML =
  '[stack]\nversion = "1"\n\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n';

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "stack-mcp-cwd-")));
  serverDir = join(root, "a-server");
  projectDir = join(root, "b-project");
  initDir = join(root, "c-init");
  const home = join(root, "home");
  const bin = join(root, "bin");
  for (const d of [serverDir, projectDir, initDir, home, bin]) mkdirSync(d, { recursive: true });
  writeFileSync(join(projectDir, ".stack.toml"), SERVICE_TOML);
  writeFileSync(join(projectDir, ".stack.local.toml"), '[stack]\nproject_id = "stk_cwd00001"\n');
  writeFileSync(join(root, "a-file"), "not a directory\n");
  symlinkSync(projectDir, join(root, "b-link"));

  const launcher = join(bin, "stack");
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${CLI_SRC}" "$@"\n`);
  chmodSync(launcher, 0o755);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_SRC],
    cwd: serverDir,
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
  client = new Client({ name: "cwd-test", version: "0.0.1" });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // best-effort
  }
  rmSync(root, { recursive: true, force: true });
});

describe("cwd input: catalog", () => {
  test("exactly the project-scoped tools declare cwd", () => {
    expect(TOOLS.filter(acceptsCwd).map((t) => t.name)).toEqual(PROJECT_SCOPED);
  });

  test("cwd is optional and shares one schema", () => {
    for (const name of PROJECT_SCOPED) {
      const def = tool(name);
      expect(def.inputSchema.properties.cwd).toBe(CWD_INPUT);
      expect(def.inputSchema.required ?? []).not.toContain("cwd");
    }
  });

  test("cwd never reaches the stack argv", () => {
    for (const name of PROJECT_SCOPED) {
      const def = tool(name);
      const input = { service: "openai", platform: "vercel", recipe_id: "r1", query: "q", cwd: projectDir };
      expect(def.cliArgs(input).join(" ")).not.toContain(projectDir);
    }
  });
});

describe("cwd input: planning and validation", () => {
  test("no cwd keeps the server's working directory", () => {
    expect(planToolCall(tool("stack_list"), { json: true })).toEqual({
      ok: true,
      args: ["list", "--json"],
      cwd: undefined,
    });
  });

  test("an absolute directory becomes the spawn cwd, argv unchanged", () => {
    expect(planToolCall(tool("stack_info"), { service: "openai", json: true, cwd: projectDir })).toEqual({
      ok: true,
      args: ["info", "openai", "--json"],
      cwd: projectDir,
    });
  });

  test("the cwd is resolved through symlinks and dot segments", () => {
    expect(resolveToolCwd(tool("stack_list"), { cwd: join(root, "b-link") })).toEqual({ cwd: projectDir });
    expect(resolveToolCwd(tool("stack_list"), { cwd: `${serverDir}/../b-project/.` })).toEqual({
      cwd: projectDir,
    });
  });

  test.each([
    { label: "a relative path", cwd: "b-project", needle: "must be an absolute path" },
    { label: "a dot path", cwd: ".", needle: "must be an absolute path" },
    { label: "an empty string", cwd: "", needle: "must be an absolute path" },
    { label: "a missing directory", cwd: "/nonexistent/stack-mcp-cwd-xyz", needle: "does not exist" },
    { label: "a NUL byte", cwd: "/tmp/\u0000x", needle: "does not exist or cannot be resolved" },
  ])("rejects $label", ({ cwd, needle }) => {
    const plan = planToolCall(tool("stack_list"), { cwd });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error.startsWith("stack_list: ")).toBe(true);
      expect(plan.error).toContain(needle);
    }
  });

  test("rejects a file", () => {
    const plan = planToolCall(tool("stack_doctor"), { cwd: join(root, "a-file") });
    expect(plan).toEqual({ ok: false, error: expect.stringContaining("is not a directory") });
  });

  test("rejects a non-string cwd", () => {
    const plan = planToolCall(tool("stack_deps"), { cwd: 42 });
    expect(plan).toEqual({ ok: false, error: 'stack_deps: argument "cwd" must be a string.' });
  });

  test("rejects cwd on a tool that is not project-scoped instead of ignoring it", () => {
    for (const name of TOOLS.filter((t) => !acceptsCwd(t)).map((t) => t.name)) {
      const plan = planToolCall(tool(name), { cwd: projectDir });
      expect(plan).toEqual({
        ok: false,
        error: expect.stringContaining(`${name}: argument "cwd" is not supported by this tool`),
      });
    }
  });

  test("existing argument validation still runs first", () => {
    expect(planToolCall(tool("stack_remove"), { service: "--all", cwd: projectDir })).toEqual({
      ok: false,
      error: expect.stringContaining('must not start with "-"'),
    });
  });
});

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

describe("cwd input: stdio server started in another directory", () => {
  test("stack_list without cwd sees the server's directory (no project there)", async () => {
    const result = await call("stack_list", { json: true });
    expect(result.content[0]?.text ?? "").not.toContain('"openai"');
  }, 20_000);

  test("stack_list with cwd targets the project directory", async () => {
    const result = await call("stack_list", { json: true, cwd: projectDir });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "") as {
      schema: string;
      services: Array<{ name: string }>;
    };
    expect(parsed.schema).toBe("ashlr.stack.list/v1");
    expect(parsed.services.map((s) => s.name)).toEqual(["openai"]);
  }, 20_000);

  test("stack_deps json with cwd reads the project's graph", async () => {
    const result = await call("stack_deps", { json: true, cwd: projectDir });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text ?? "").toContain("openai");
  }, 20_000);

  test("stack_init with cwd writes .stack.toml there, not in the server's directory", async () => {
    const result = await call("stack_init", { cwd: initDir });
    expect(result.isError).toBeFalsy();
    expect(existsSync(join(initDir, ".stack.toml"))).toBe(true);
    expect(existsSync(join(serverDir, ".stack.toml"))).toBe(false);
    expect(readFileSync(join(projectDir, ".stack.toml"), "utf8")).toBe(SERVICE_TOML);
  }, 20_000);

  test.each([
    { label: "a relative path", cwd: () => "b-project", needle: "must be an absolute path" },
    { label: "a file", cwd: () => join(root, "a-file"), needle: "is not a directory" },
  ])("$label as cwd is an isError result and runs nothing", async ({ cwd, needle }) => {
    const result = await call("stack_list", { json: true, cwd: cwd() });
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text.startsWith("stack_list: ")).toBe(true);
    expect(text).toContain(needle);
  }, 20_000);
});
