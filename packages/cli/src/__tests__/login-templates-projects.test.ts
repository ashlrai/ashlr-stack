import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerProject } from "@ashlr/stack-core";
import { type Harness, setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";

/**
 * Commands an agent runs without a terminal: `stack login` names the command
 * a person must run, `templates list` / `projects list` have a --json shape,
 * and an unknown template points at the list of names.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

let h: Harness;
let dir: string;

beforeEach(() => {
  h = setupFakePhantom({}, { initialized: true });
  dir = mkdtempSync(join(tmpdir(), "stack-ltp-"));
});

afterEach(() => {
  h.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function stack(args: string[], cwd = dir): { code: number | null; out: string; stdout: string } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1", STACK_NO_UPDATE_CHECK: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  const stdout = result.stdout ?? "";
  return { code: result.status, stdout, out: stdout + (result.stderr ?? "") };
}

describe("stack login without a terminal", () => {
  it("fails with exit 1 and the `stack login <provider>` a person must run", () => {
    writeFileSync(join(dir, ".stack.toml"), '[stack]\nversion = "1"\n');
    writeFileSync(join(dir, ".stack.local.toml"), '[stack]\nproject_id = "stk_ltplogin"\n');
    const { code, out } = stack(["login", "openai"]);
    expect(code).toBe(1);
    expect(out).toContain("interactive terminal");
    expect(out).toContain("`stack login openai`");
    expect(out).not.toContain("nothing was added");
    expect(h.callsTo("add")).toEqual([]);
  });
});

describe("stack templates list --json", () => {
  it("prints ashlr.stack.templates/v1 with each template's services, no banner", () => {
    const { code, stdout } = stack(["templates", "list", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.schema).toBe("ashlr.stack.templates/v1");
    const neon = report.templates.find(
      (t: { name: string }) => t.name === "nextjs-neon-vercel-sentry",
    );
    expect(report.total).toBe(report.templates.length);
    expect(neon.services.map((s: { name: string }) => s.name)).toEqual([
      "neon",
      "vercel",
      "sentry",
    ]);
  });

  it("bare `stack templates --json` is the same report", () => {
    const { code, stdout } = stack(["templates", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).schema).toBe("ashlr.stack.templates/v1");
  });

  it("an unknown template names the command that lists them", () => {
    const { code, out } = stack(["templates", "apply", "nope"]);
    expect(code).toBe(1);
    expect(out).toContain("Unknown template: nope");
    expect(out).toContain("stack templates list");
  });
});

describe("stack projects list --json", () => {
  it("prints an empty ashlr.stack.projects/v1 report on a fresh machine", () => {
    const { code, stdout } = stack(["projects", "list", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      schema: "ashlr.stack.projects/v1",
      total: 0,
      projects: [],
    });
  });

  it("lists registered projects with path, id, template and services", async () => {
    const project = join(dir, "app");
    mkdirSync(project);
    writeFileSync(
      join(project, ".stack.toml"),
      '[stack]\nversion = "1"\ntemplate = "nextjs-supabase-posthog"\n\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n',
    );
    writeFileSync(join(project, ".stack.local.toml"), '[stack]\nproject_id = "stk_ltpproj"\n');
    expect(await registerProject(project)).toBeDefined();

    const { code, stdout } = stack(["projects", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.schema).toBe("ashlr.stack.projects/v1");
    expect(report.projects).toHaveLength(1);
    expect(report.projects[0]).toMatchObject({
      name: "app",
      project_id: "stk_ltpproj",
      template: "nextjs-supabase-posthog",
      services: ["openai"],
    });
    expect(typeof report.projects[0].path).toBe("string");
  });
});
