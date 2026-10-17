import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `stack list --json`, `stack deps --json` and `stack providers --json` are
 * the machine contracts agents (and the MCP server) consume: stdout is one
 * valid JSON document with no banners or ANSI, and a missing .stack.toml is
 * a JSON `{ error }` with a non-zero exit.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "stack-list-json-"));
  created.push(d);
  return d;
}

function project(): string {
  const d = tmp();
  writeFileSync(
    join(d, ".stack.toml"),
    [
      "[stack]",
      'version = "1"',
      'template = "starter"',
      "",
      "[services.openai]",
      'provider = "openai"',
      'secrets = ["OPENAI_API_KEY"]',
      'mcp = "openai"',
      "",
      "[services.ghost]",
      'provider = "not-a-provider"',
      'secrets = ["GHOST_TOKEN"]',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(d, ".stack.local.toml"),
    '[stack]\nproject_id = "stk_json0001"\n\n[services.openai]\nresource_id = "org-1"\nregion = "us"\n',
  );
  return d;
}

function stack(args: string[], cwd: string, color = false) {
  const r = spawnSync("bun", [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      ...(color ? { FORCE_COLOR: "1" } : { NO_COLOR: "1" }),
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
    },
    timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const ESC = String.fromCharCode(27);

describe("stack list --json", () => {
  test("emits the ashlr.stack.list/v1 contract", () => {
    const r = stack(["list", "--json"], project(), true);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(ESC);
    const report = JSON.parse(r.stdout);
    expect(report.schema).toBe("ashlr.stack.list/v1");
    expect(report.project_id).toBe("stk_json0001");
    expect(report.template).toBe("starter");
    expect(report.services).toEqual([
      {
        name: "openai",
        provider: "openai",
        resource_id: "org-1",
        region: "us",
        secrets: ["OPENAI_API_KEY"],
        mcp: "openai",
      },
      {
        name: "ghost",
        provider: "not-a-provider",
        resource_id: null,
        region: null,
        secrets: ["GHOST_TOKEN"],
        mcp: null,
      },
    ]);
  });

  test("without a .stack.toml: JSON error on stdout, exit 1", () => {
    const r = stack(["list", "--json"], tmp());
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("Run `stack init` first.");
  });

  test("human output is unchanged without --json", () => {
    const r = stack(["list"], project());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("stk_json0001");
    expect(r.stdout).toContain("(2 services)");
    expect(() => JSON.parse(r.stdout)).toThrow();
  });
});

describe("stack deps --json", () => {
  test("emits the ashlr.stack.deps/v1 contract", () => {
    const r = stack(["deps", "--json"], project(), true);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(ESC);
    const report = JSON.parse(r.stdout);
    expect(report.schema).toBe("ashlr.stack.deps/v1");
    expect(report.project_id).toBe("stk_json0001");
    expect(report.categories).toEqual([
      {
        category: "ai",
        services: [
          {
            name: "openai",
            provider: "openai",
            displayName: "OpenAI",
            secrets: ["OPENAI_API_KEY"],
            mcp: "openai",
          },
        ],
      },
    ]);
    expect(report.unresolved).toEqual(["ghost"]);
    expect(report.totals).toEqual({ services: 2, secrets: 2, mcp: 1 });
  });

  test("without a .stack.toml: JSON error on stdout, exit 1", () => {
    const r = stack(["deps", "--json"], tmp());
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("Run `stack init` first.");
  });
});

describe("stack providers --json", () => {
  test("emits the ashlr.stack.providers/v1 contract with no intro banner", () => {
    const r = stack(["providers", "--json"], tmp(), true);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(ESC);
    expect(r.stdout).not.toContain("stack providers");
    const report = JSON.parse(r.stdout);
    expect(report.schema).toBe("ashlr.stack.providers/v1");
    expect(report.unavailable).toEqual([]);
    expect(report.providers).toHaveLength(report.total);
    const openai = report.providers.find((p: { name: string }) => p.name === "openai");
    expect(openai).toMatchObject({
      name: "openai",
      displayName: "OpenAI",
      category: "ai",
      authKind: "api_key",
    });
  });
});
