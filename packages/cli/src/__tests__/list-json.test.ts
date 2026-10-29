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

  test("emits one JSON document for populated services with aliases and escaped values", () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, ".stack.toml"),
      `[stack]
version = "1"
template = "starter"

[services."primary.ai"]
provider = "openai"
secrets = ["OPENAI_API_KEY", "OPENAI_ORG_ID"]
mcp = "openai"

[services.backup]
provider = "openai"
secrets = []
`,
    );
    writeFileSync(
      join(cwd, ".stack.local.toml"),
      `[stack]
project_id = "stk_alias001"

[services."primary.ai"]
resource_id = 'org-"quoted"'
region = "eu-west"
`,
    );

    const r = stack(["list", "--json"], cwd, true);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(ESC);
    expect(JSON.parse(r.stdout)).toEqual({
      schema: "ashlr.stack.list/v1",
      project_id: "stk_alias001",
      template: "starter",
      services: [
        {
          name: "primary.ai",
          provider: "openai",
          resource_id: 'org-"quoted"',
          region: "eu-west",
          secrets: ["OPENAI_API_KEY", "OPENAI_ORG_ID"],
          mcp: "openai",
        },
        {
          name: "backup",
          provider: "openai",
          resource_id: null,
          region: null,
          secrets: [],
          mcp: null,
        },
      ],
    });
  });

  test("emits a JSON report with no services for an empty stack", () => {
    const cwd = tmp();
    writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\ntemplate = "starter"\n');
    writeFileSync(join(cwd, ".stack.local.toml"), '[stack]\nproject_id = "stk_empty001"\n');

    const r = stack(["list", "--json"], cwd, true);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(ESC);
    expect(JSON.parse(r.stdout)).toEqual({
      schema: "ashlr.stack.list/v1",
      project_id: "stk_empty001",
      template: "starter",
      services: [],
    });
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

describe("stack providers --category", () => {
  test("lists one category in any case and says which", () => {
    const r = stack(["providers", "--category", "DataBase", "--json"], tmp(), true);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.category).toBe("database");
    expect(report.providers.length).toBeGreaterThan(0);
    expect(report.providers).toHaveLength(report.total);
    for (const p of report.providers) expect(p.category).toBe("database");
  });

  test("the unfiltered report carries category null", () => {
    const report = JSON.parse(stack(["providers", "--json"], tmp(), true).stdout);
    expect(report.category).toBeNull();
  });

  test("an unknown category exits 1 and names the valid ones", () => {
    const r = stack(["providers", "--category", "dbs", "--json"], tmp(), true);
    expect(r.code).toBe(1);
    const { error } = JSON.parse(r.stdout);
    expect(error).toContain('Unknown category "dbs"');
    expect(error).toContain("database");
    const human = stack(["providers", "--category", "dbs"], tmp(), true);
    expect(human.code).toBe(1);
  });
});
