import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Smoke tests for `stack recommend`. Spawns the CLI the same way the MCP
 * server will (bun subprocess) to cover the full JSON contract end-to-end.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1" },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 0,
  };
}

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-recommend-"));
  createdDirs.push(dir);
  return dir;
}

describe("stack recommend --json", () => {
  it("returns structured JSON with hits for a SaaS query", () => {
    const { stdout, code } = runCli(["recommend", "B2B SaaS with auth and payments", "--json"]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.query).toBe("B2B SaaS with auth and payments");
    expect(Array.isArray(payload.hits)).toBe(true);
    expect(payload.hits.length).toBeGreaterThan(0);
    const hitNames = payload.hits.map((h: { name: string }) => h.name);
    expect(hitNames).toContain("stripe");
    // clerk or supabase should cover the auth side
    expect(hitNames.some((n: string) => ["clerk", "supabase"].includes(n))).toBe(true);
    expect(typeof payload.guidance).toBe("string");
    expect(payload.byCategory).toBeDefined();
    const commandSection: string | undefined = payload.guidance
      .split("Apply a chosen set with: ")[1]
      ?.split(" (")[0];
    expect(commandSection).toBeDefined();
    const commands = commandSection?.split(" && ").map((command) => command.trim().split(/\s+/));
    expect(commands).toEqual(
      payload.hits.slice(0, 3).map((hit: { name: string }) => ["stack", "add", hit.name]),
    );
  });

  it("narrows to a category filter", () => {
    const { stdout, code } = runCli([
      "recommend",
      "edge compute",
      "--category",
      "Deploy",
      "--json",
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    for (const hit of payload.hits) {
      expect(hit.category).toBe("Deploy");
    }
  });

  it("matches --category case-insensitively", () => {
    const { stdout, code } = runCli([
      "recommend",
      "serverless postgres",
      "--category",
      "database",
      "--json",
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.hits.length).toBeGreaterThan(0);
    for (const hit of payload.hits) {
      expect(hit.category).toBe("Database");
    }
  });

  it("rejects an unknown --category instead of returning nothing", () => {
    const { stdout, stderr, code } = runCli([
      "recommend",
      "serverless postgres",
      "--category",
      "bogus",
      "--json",
    ]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain('Unknown category "bogus"');
    expect(stderr).toContain("Database");
  });

  it("with --save persists a recipe under .stack/recipes/", () => {
    const dir = mkTmp();
    const { stdout, code } = runCli(["recommend", "postgres database", "--save", "--json"], dir);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.recipe).toBeDefined();
    expect(payload.recipe.id).toBeDefined();
    expect(payload.recipe.path).toContain(".stack/recipes");

    const recipesDir = join(dir, ".stack", "recipes");
    const files = readdirSync(recipesDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.toml$/);
    expect(files[0]).toBe(`${payload.recipe.id}.toml`);
  });

  it("without --save does not create .stack/recipes", () => {
    const dir = mkTmp();
    const { code } = runCli(["recommend", "postgres database", "--json"], dir);
    expect(code).toBe(0);
    try {
      const files = readdirSync(join(dir, ".stack", "recipes"));
      expect(files.length).toBe(0);
    } catch (err) {
      // ENOENT is the expected happy path — no dir created.
      expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  });

  it("emits an empty hits array with fallback guidance for a gibberish query", () => {
    const { stdout, code } = runCli(["recommend", "xyzabcxyzabc nonsenseword", "--json"]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.hits).toEqual([]);
    expect(payload.guidance).toContain("No strong matches");
  });

  it("exits 1 when no query is given, in JSON and human mode", () => {
    const json = runCli(["recommend", "--json"]);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout).guidance).toContain("Provide a query");
    const blank = runCli(["recommend", "   ", "--json"]);
    expect(blank.code).toBe(1);
    const human = runCli(["recommend"]);
    expect(human.code).toBe(1);
    expect(human.stdout + human.stderr).toContain("No query");
  });

  it("rejects a --k that is not a whole number of 1 or more", () => {
    for (const k of ["abc", "0", "2.5"]) {
      const { stdout, stderr, code } = runCli(["recommend", "postgres", "--k", k, "--json"]);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain(`Invalid --k "${k}"`);
    }
  });

  it("names a negative --k given as a separate token", () => {
    // `--k -1` reached the command as an empty --k, reported as "no value".
    for (const k of ["-1", "-3"]) {
      const { stdout, stderr, code } = runCli(["recommend", "postgres", "--k", k, "--json"]);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain(`Invalid --k "${k}"`);
      expect(stderr).not.toContain("no value");
    }
  });

  it("honours a valid --k", () => {
    const { stdout, code } = runCli(["recommend", "postgres database", "--k", "2", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).hits.length).toBe(2);
  });
});
