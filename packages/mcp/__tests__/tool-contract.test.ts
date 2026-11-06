import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = mkdtempSync(join(tmpdir(), "stack-tool-contract-"));
const marker = join(root, "cli-called");
const fake = join(root, "stack");
const client = new Client({ name: "tool-contract", version: "1.0.0" });
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];

beforeAll(async () => {
  // Any accidental dispatch is observable, without touching credentials or providers.
  writeFileSync(fake, '#!/bin/sh\ntouch "$HOME/cli-called"\nprintf "contract fixture\\n"\n');
  chmodSync(fake, 0o700);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["run", join(import.meta.dir, "../src/server.ts")],
    cwd: root,
    env: { HOME: root, STACK_BIN: fake, PATH: process.env.PATH ?? "" },
  }));
  ({ tools } = await client.listTools());
  expect(tools.length).toBeGreaterThan(0);
}, 20_000);

afterAll(async () => {
  try {
    await client.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function rejects(name: string, args: Record<string, unknown> | undefined, field: string) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name}.${field}: ${JSON.stringify(args)}`).toBe(true);
  expect(result.content).toEqual(expect.any(Array));
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).toContain(name);
  expect(text).toContain(`"${field}"`);
  expect(existsSync(marker)).toBe(false);
}

test("live tools reject missing required fields and every wrong field type without dispatch", async () => {
  for (const tool of tools) {
    const properties = tool.inputSchema.properties ?? {};
    const required = tool.inputSchema.required ?? [];
    const valid = Object.fromEntries(required.map((key) => {
      const spec = properties[key] as { type: string };
      return [key, spec.type === "string" ? "example" : spec.type === "boolean" ? false : 1];
    }));
    if (required.length) {
      // Exercise arguments omitted entirely as well as each field individually.
      await rejects(tool.name, undefined, required[0]);
    }
    for (const field of required) {
      const missing = { ...valid };
      delete missing[field];
      await rejects(tool.name, missing, field);
      for (const value of [null, "", "   "]) {
        await rejects(tool.name, { ...valid, [field]: value }, field);
      }
    }
    for (const [field, schema] of Object.entries(properties)) {
      const spec = schema as { type: string };
      for (const value of [null, [], {}, true, 42, "wrong"]) {
        if (value !== null && typeof value === spec.type) continue;
        await rejects(tool.name, { ...valid, [field]: value }, field);
      }
    }
    // Also covers zero-argument tools, which have no invalid declared field.
    await rejects(tool.name, { ...valid, unexpected_contract_field: true }, "unexpected_contract_field");
    await client.ping();
  }
}, 20_000);

test("omitting optional arguments remains valid for every live tool without required fields", async () => {
  for (const tool of tools.filter((tool) => !tool.inputSchema.required?.length)) {
    const result = await client.callTool({ name: tool.name });
    expect(result.isError, tool.name).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "contract fixture" }]);
  }
  await client.ping();
});
