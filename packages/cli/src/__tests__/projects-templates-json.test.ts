import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `stack projects list --json` and `stack templates list --json` used to
 * ignore `--json` and print the decorated human list, so an agent (or the
 * MCP `stack_projects_list` / `stack_templates_list` tools) had to scrape
 * banners. Both now emit one JSON document on stdout.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const ESC = String.fromCharCode(27);

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "stack-reg-json-")));
  created.push(d);
  return d;
}

function stack(args: string[], cwd: string, registryDir: string) {
  const r = spawnSync("bun", [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      FORCE_COLOR: "1",
      STACK_REGISTRY_DIR: registryDir,
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
    },
    timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("stack projects list --json", () => {
  test("empty registry: ashlr.stack.projects/v1 with no projects", () => {
    const root = tmp();
    const r = stack(["projects", "list", "--json"], root, join(root, "reg"));
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(ESC);
    expect(JSON.parse(r.stdout)).toEqual({
      schema: "ashlr.stack.projects/v1",
      total: 0,
      projects: [],
    });
  });

  test("lists a registered project; bare `stack projects --json` matches", () => {
    const root = tmp();
    const registry = join(root, "reg");
    const project = join(root, "shop");
    mkdirSync(project);
    writeFileSync(
      join(project, ".stack.toml"),
      '[stack]\nversion = "1"\ntemplate = "starter"\n\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n',
    );
    writeFileSync(join(project, ".stack.local.toml"), '[stack]\nproject_id = "stk_reg00001"\n');
    expect(stack(["projects", "register"], project, registry).code).toBe(0);

    const r = stack(["projects", "list", "--json"], root, registry);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.schema).toBe("ashlr.stack.projects/v1");
    expect(report.total).toBe(1);
    expect(report.projects[0]).toMatchObject({
      name: "shop",
      path: project,
      project_id: "stk_reg00001",
      template: "starter",
      services: ["openai"],
    });
    expect(typeof report.projects[0].last_seen).toBe("string");

    const bare = stack(["projects", "--json"], root, registry);
    expect(JSON.parse(bare.stdout)).toEqual(report);
  });

  test("human output is unchanged without --json", () => {
    const root = tmp();
    const r = stack(["projects", "list"], root, join(root, "reg"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No projects registered yet");
  });
});

describe("stack projects where", () => {
  test("finds a project by its exact name among similarly named projects", () => {
    const root = tmp();
    const registry = join(root, "reg");
    for (const name of ["shop-admin", "shop"]) {
      const project = join(root, name);
      mkdirSync(project);
      writeFileSync(join(project, ".stack.toml"), '[stack]\nversion = "1"\n');
      expect(stack(["projects", "register"], project, registry).code).toBe(0);
    }

    const result = stack(["projects", "where", "shop"], root, registry);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(join(root, "shop"));
  });
});

describe("stack templates list --json", () => {
  test("emits ashlr.stack.templates/v1 with each template's services", () => {
    const root = tmp();
    const r = stack(["templates", "list", "--json"], root, join(root, "reg"));
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(ESC);
    const report = JSON.parse(r.stdout);
    expect(report.schema).toBe("ashlr.stack.templates/v1");
    expect(report.total).toBe(report.templates.length);
    expect(report.total).toBeGreaterThan(0);
    const starter = report.templates.find(
      (t: { name: string }) => t.name === "nextjs-supabase-posthog",
    );
    expect(starter.services.map((s: { provider: string }) => s.provider)).toEqual([
      "supabase",
      "posthog",
    ]);
    expect(starter.services[0]).toEqual({
      name: "supabase",
      provider: "supabase",
      secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      mcp: "supabase",
    });

    const bare = stack(["templates", "--json"], root, join(root, "reg"));
    expect(JSON.parse(bare.stdout)).toEqual(report);
  });

  test("human output is unchanged without --json", () => {
    const root = tmp();
    const r = stack(["templates", "list"], root, join(root, "reg"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("nextjs-supabase-posthog");
    expect(() => JSON.parse(r.stdout)).toThrow();
  });
});
