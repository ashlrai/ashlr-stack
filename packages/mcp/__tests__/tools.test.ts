/**
 * Unit tests for the MCP tool catalog and `stack` CLI resolution. These import
 * src/ directly (no stdio server) so they run without a build.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cliBinFromPackageJson,
  readServerVersion,
  resolveCliPackageJson,
  resolveStackCommand,
} from "../src/stack-bin.ts";
import { TOOLS, validateToolInput } from "../src/tools.ts";

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function fakeCliPackage(bin: unknown, writeBin = true): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-mcp-bin-"));
  created.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@ashlr/stack", bin }));
  if (writeBin) {
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "index.js"), "");
  }
  return join(dir, "package.json");
}

function tool(name: string) {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`missing tool ${name}`);
  return def;
}

describe("stack_scan args", () => {
  test("always passes --json (MCP has no TTY)", () => {
    expect(tool("stack_scan").cliArgs({})).toEqual(["scan", "--json"]);
  });

  test("keeps --json alongside path + confidence", () => {
    expect(tool("stack_scan").cliArgs({ path: "app", confidence: "high" })).toEqual([
      "scan",
      "--json",
      "--path",
      "app",
      "--confidence",
      "high",
    ]);
  });
});

describe("validateToolInput", () => {
  test("rejects a missing required argument instead of passing \"undefined\"", () => {
    for (const name of ["stack_add", "stack_remove", "stack_info", "stack_sync", "stack_apply"]) {
      expect(validateToolInput(tool(name), {})).toContain("missing required argument");
    }
    expect(validateToolInput(tool("stack_recommend"), { query: "" })).toContain(
      'missing required argument "query"',
    );
  });

  test("rejects values that the CLI would parse as flags", () => {
    expect(validateToolInput(tool("stack_remove"), { service: "--all" })).toContain(
      'must not start with "-"',
    );
    expect(validateToolInput(tool("stack_add"), { service: "--help" })).toContain(
      'must not start with "-"',
    );
    expect(validateToolInput(tool("stack_import"), { from: "--dryRun" })).toContain(
      'must not start with "-"',
    );
  });

  test("rejects wrong types", () => {
    expect(validateToolInput(tool("stack_add"), { service: { x: 1 } })).toContain(
      "must be a string",
    );
    expect(validateToolInput(tool("stack_recommend"), { query: "db", k: "abc" })).toContain(
      "must be a number",
    );
    expect(validateToolInput(tool("stack_doctor"), { fix: "yes" })).toContain("must be a boolean");
  });

  test("accepts well-formed input", () => {
    expect(validateToolInput(tool("stack_remove"), { service: "supabase", keepRemote: true })).toBe(
      null,
    );
    expect(validateToolInput(tool("stack_recommend"), { query: "postgres", k: 3 })).toBe(null);
    expect(validateToolInput(tool("stack_list"), {})).toBe(null);
  });
});

describe("resolveStackCommand", () => {
  test("STACK_BIN wins over the bundled dependency", () => {
    const pkg = fakeCliPackage({ stack: "./dist/index.js" });
    expect(resolveStackCommand({ STACK_BIN: "/opt/stack" }, () => pkg)).toEqual({
      command: "/opt/stack",
      prefixArgs: [],
      source: "env",
    });
  });

  test("runs the @ashlr/stack bin with the current runtime", () => {
    const pkg = fakeCliPackage({ stack: "./dist/index.js" });
    const cmd = resolveStackCommand({}, () => pkg);
    expect(cmd.source).toBe("package");
    expect(cmd.command).toBe(process.execPath);
    expect(cmd.prefixArgs).toEqual([join(pkg, "..", "dist", "index.js")]);
  });

  test("accepts a string bin field", () => {
    const pkg = fakeCliPackage("./dist/index.js");
    expect(cliBinFromPackageJson(pkg)).toBe(join(pkg, "..", "dist", "index.js"));
  });

  test("falls back to `stack` on PATH when the bin file is missing", () => {
    const pkg = fakeCliPackage({ stack: "./dist/index.js" }, false);
    expect(resolveStackCommand({}, () => pkg)).toEqual({
      command: "stack",
      prefixArgs: [],
      source: "path",
    });
  });

  test("falls back to `stack` on PATH when @ashlr/stack is not installed", () => {
    expect(resolveStackCommand({}, () => undefined).source).toBe("path");
  });

  test("the workspace dependency on @ashlr/stack resolves", () => {
    const pkg = resolveCliPackageJson();
    expect(pkg).toBeDefined();
    expect(JSON.parse(readFileSync(pkg as string, "utf-8")).name).toBe("@ashlr/stack");
  });
});

describe("readServerVersion", () => {
  test("matches packages/mcp/package.json", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));
    expect(readServerVersion()).toBe(pkg.version);
  });

  test("resolves from a dist/ module path too", () => {
    const distUrl = pathToFileURL(join(import.meta.dir, "..", "dist", "server.js")).href;
    expect(readServerVersion(distUrl)).toMatch(/^\d+\.\d+\.\d+/);
    expect(readServerVersion(distUrl)).not.toBe("0.0.0");
  });
});

describe("structured-output tools", () => {
  test("stack_list, stack_providers and stack_deps pass --json only when asked", () => {
    for (const [name, command] of [
      ["stack_list", "list"],
      ["stack_providers", "providers"],
      ["stack_deps", "deps"],
    ] as const) {
      const def = tool(name);
      expect(def.inputSchema.properties.json?.type).toBe("boolean");
      expect(def.cliArgs({})).toEqual([command]);
      expect(def.cliArgs({ json: true })).toEqual([command, "--json"]);
      expect(validateToolInput(def, { json: "yes" })).toContain('"json" must be a boolean');
    }
  });
});
