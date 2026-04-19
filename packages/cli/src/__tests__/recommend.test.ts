import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Smoke tests for `stack recommend`. Spawns the CLI the same way the MCP
 * server will (bun subprocess) to cover the full JSON contract end-to-end.
 */

const CLI_ENTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "index.ts",
);

function runCli(
  args: string[],
  cwd?: string,
): { stdout: string; stderr: string; code: number } {
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
    const dir = createdDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-recommend-"));
  createdDirs.push(dir);
  return dir;
}

describe("stack recommend --json", () => {
  it("returns structured JSON with hits for a SaaS query", () => {
    const { stdout, code } = runCli([
      "recommend",
      "B2B SaaS with auth and payments",
      "--json",
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.query).toBe("B2B SaaS with auth and payments");
    expect(Array.isArray(payload.hits)).toBe(true);
    expect(payload.hits.length).toBeGreaterThan(0);
    const hitNames = payload.hits.map((h: { name: string }) => h.name);
    expect(hitNames).toContain("stripe");
    // clerk or supabase should cover the auth side
    expect(hitNames.some((n: string) => ["clerk", "supabase"].includes(n))).toBe(
      true,
    );
    expect(typeof payload.guidance).toBe("string");
    expect(payload.byCategory).toBeDefined();
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

  it("with --save persists a recipe under .stack/recipes/", () => {
    const dir = mkTmp();
    const { stdout, code } = runCli(
      ["recommend", "postgres database", "--save", "--json"],
      dir,
    );
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
    const { stdout, code } = runCli([
      "recommend",
      "xyzabcxyzabc nonsenseword",
      "--json",
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.hits).toEqual([]);
    expect(payload.guidance).toContain("No strong matches");
  });
});
