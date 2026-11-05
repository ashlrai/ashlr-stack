/**
 * Regression: a `stack_apply` tools/call with a missing `recipe_id` value.
 *
 * Before input validation ran ahead of argv building in `planToolCall`, a
 * missing required field reached the CLI as the literal placeholder string
 * "undefined" — `stack apply undefined` — which the spawned CLI then treated
 * as a real recipe id. The documented result for a missing value is an
 * isError result naming the argument (`stack_apply: missing required
 * argument "recipe_id".`), and nothing is spawned: no argv, no placeholder,
 * no process.
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { planToolCall } from "../src/cwd.ts";
import { TOOLS, type ToolDef } from "../src/tools.ts";

const SERVER_SRC = join(import.meta.dir, "..", "src", "server.ts");
const DOCUMENTED_ERROR = 'stack_apply: missing required argument "recipe_id".';

const apply = TOOLS.find((tool) => tool.name === "stack_apply") as ToolDef;

const MISSING_INPUTS = [
  { label: "omitted", input: {} },
  { label: "undefined", input: { recipe_id: undefined } },
  { label: "null", input: { recipe_id: null } },
  { label: "empty", input: { recipe_id: "" } },
  { label: "blank", input: { recipe_id: "   " } },
] as const;

describe("planToolCall", () => {
  test.each(MISSING_INPUTS)(
    "a missing recipe_id ($label) returns the documented error and plans no argv",
    ({ input }) => {
      // { ok: false } carries no args: nothing reaches runStack, so no
      // placeholder value is written into a spawned command.
      expect(planToolCall(apply, input)).toEqual({ ok: false, error: DOCUMENTED_ERROR });
    },
  );

  test("the raw argv builder is where the placeholder would land", () => {
    // cliArgs stringifies blindly — the placeholder this regression guards
    // is exactly what an unvalidated request would write into argv.
    expect(apply.cliArgs({})).toEqual(["apply", "undefined"]);
  });
});

describe("tools/call on the real server", () => {
  let root: string;
  let projectDir: string;
  let argvLog: string;
  let client: Client;

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "stack-mcp-apply-missing-")));
    projectDir = join(root, "project");
    const home = join(root, "home");
    const bin = join(root, "bin");
    for (const dir of [projectDir, home, bin]) mkdirSync(dir, { recursive: true });
    argvLog = join(root, "stack-argv.log");

    // A `stack` shim that records each invocation's argv to STACK_ARGV_LOG.
    // If a missing-value request ever spawned the CLI, this file would name
    // the placeholder it was handed.
    const recorder = join(bin, "stack");
    writeFileSync(recorder, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$STACK_ARGV_LOG"\n');
    chmodSync(recorder, 0o755);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", SERVER_SRC],
      cwd: projectDir,
      env: {
        PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
        HOME: home,
        STACK_BIN: recorder,
        STACK_ARGV_LOG: argvLog,
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
        DO_NOT_TRACK: "1",
      },
    });
    client = new Client({ name: "apply-missing-value-test", version: "0.0.1" });
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

  async function call(args: Record<string, unknown>) {
    return (await client.callTool({ name: "stack_apply", arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
  }

  test.each(MISSING_INPUTS)(
    "a missing recipe_id ($label) is an isError result and writes no placeholder argv",
    async ({ input }) => {
      const result = await call({ ...input, cwd: projectDir });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(DOCUMENTED_ERROR);
      expect(result.content[0]?.text).not.toContain("undefined");
      // The request never reached the CLI: the recorder wrote no "undefined"
      // placeholder — or anything at all.
      expect(existsSync(argvLog)).toBe(false);
    },
    20_000,
  );

  test("a present recipe_id does run `stack apply` (the recorder works)", async () => {
    const result = await call({ recipe_id: "r1", cwd: projectDir });
    expect(result.isError).toBeFalsy();
    expect(readFileSync(argvLog, "utf-8").trim()).toBe("apply r1");
  }, 20_000);
});
