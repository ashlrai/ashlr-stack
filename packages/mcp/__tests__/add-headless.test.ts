/**
 * End-to-end: an agent calls `stack_add` for a provider that needs a pasted
 * key. The MCP server runs the CLI with no stdin and no TTY, so the call must
 * fail fast with a message that says what a person has to do, not hang on a
 * prompt or stop at "no valid key".
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type Harness, setupFakePhantom } from "../../core/src/__tests__/_harness.ts";

const SERVER_SRC = join(import.meta.dir, "..", "src", "server.ts");
const CLI_SRC = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

let dir: string;
let h: Harness;
let client: Client;

beforeAll(async () => {
  h = setupFakePhantom({}, { initialized: true });
  dir = mkdtempSync(join(tmpdir(), "stack-mcp-add-"));
  const project = join(dir, "proj");
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  for (const d of [project, home, bin]) mkdirSync(d, { recursive: true });
  writeFileSync(join(project, ".stack.toml"), '[stack]\nversion = "1"\n');
  writeFileSync(join(project, ".stack.local.toml"), '[stack]\nproject_id = "stk_mcpadd01"\n');
  const launcher = join(bin, "stack");
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${CLI_SRC}" "$@"\n`);
  chmodSync(launcher, 0o755);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_SRC],
    cwd: project,
    env: {
      PATH: [h.dir, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      HOME: home,
      STACK_BIN: launcher,
      STACK_REGISTRY_DIR: join(dir, "registry"),
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
    },
  });
  client = new Client({ name: "add-headless-test", version: "0.0.1" });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // best-effort
  }
  h.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP stack_add without a terminal", () => {
  for (const provider of ["openai", "neon"]) {
    test(`${provider}: fails with the command a person must run`, async () => {
      const res = await client.callTool({ name: "stack_add", arguments: { service: provider } });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("interactive terminal");
      expect(text).toContain(`\`stack add ${provider}\``);
      // Nothing was stored or prompted for.
      expect(h.callsTo("add")).toEqual([]);
    }, 20_000);
  }
});
