import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// First-run contract: the README's "Try it in 30 seconds" commands and a
// `--help` page for every command the README names must work against the
// *built* entry (packages/cli/dist/index.js, run under node like the published
// bin) in an empty directory with an empty HOME — the state a brand-new user
// is in. Dist is gitignored, so the test rebuilds it first; the build script
// itself invokes `node`, so a node binary on PATH is a precondition either way.

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(SRC_DIR, "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const DIST_ENTRY = join(PKG_DIR, "dist", "index.js");
const README = join(REPO_ROOT, "README.md");

// Every subcommand the README names lives in the generated commands-table block.
function readmeCommands(): string[] {
  const text = readFileSync(README, "utf8");
  const block = text.match(/<!-- fresh:begin commands-table -->([\s\S]*?)<!-- fresh:end -->/);
  if (!block) throw new Error("README.md has no commands-table fresh block");
  const names = [...block[1].matchAll(/\| `stack ([a-z0-9-]+)` \|/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("README commands-table lists no commands");
  return names;
}

const created: string[] = [];
afterAll(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function emptyDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Run the built entry the way the published bin does: `node dist/index.js`,
// from an empty cwd, with HOME pointing at a fresh empty directory and the
// minimal env used by the other CLI tests (no inherited test-runner vars).
function stack(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [DIST_ENTRY, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: emptyDir("stack-first-run-home-"),
        NO_COLOR: "1",
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Cold node startups dominate here (each spawn is seconds on a slow box), so
// independent invocations are fanned out through a small worker pool — the
// same pattern help.test.ts uses.
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

const NO_CRASH = /^\s+at |panic|undefined is not|cannot read prop/i;

beforeAll(() => {
  const build = spawnSync("bun", ["run", "build"], { cwd: PKG_DIR, encoding: "utf8" });
  if (build.status !== 0) {
    throw new Error(`cli build failed:\n${build.stdout}${build.stderr}`);
  }
  if (!existsSync(DIST_ENTRY)) throw new Error("build produced no dist/index.js");
}, 60_000);

describe("built entry", () => {
  test("dist/index.js is an executable node bundle", () => {
    const firstLine = readFileSync(DIST_ENTRY, "utf8").split("\n", 1)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
    expect(readdirSync(join(PKG_DIR, "dist"))).toContain("index.js");
  });
});

describe("README quickstart commands", () => {
  test("stack providers lists the catalog, exit 0", async () => {
    const r = await stack(["providers"], emptyDir("stack-first-run-"));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/providers? total/i);
    expect(r.stdout).toContain("supabase");
    expect(`${r.stdout}${r.stderr}`).not.toMatch(NO_CRASH);
  }, 30_000);

  test("stack recommend ranks picks for a sample brief, exit 0", async () => {
    const r = await stack(
      ["recommend", "B2B SaaS with auth, AI, and payments"],
      emptyDir("stack-first-run-"),
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/stack add [a-z0-9-]+/);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(NO_CRASH);
  }, 30_000);

  test("stack recommend --json emits parseable hits, exit 0", async () => {
    const r = await stack(
      ["recommend", "B2B SaaS with auth, AI, and payments", "--json"],
      emptyDir("stack-first-run-"),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { query: string; hits: { name: string }[] };
    expect(parsed.query).toBe("B2B SaaS with auth, AI, and payments");
    expect(parsed.hits.length).toBeGreaterThan(0);
    expect(parsed.hits[0].name).toMatch(/^[a-z0-9-]+$/);
  }, 30_000);

  test("stack scan writes nothing in an empty dir, exit 0", async () => {
    const cwd = emptyDir("stack-first-run-");
    const r = await stack(["scan"], cwd);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No providers detected");
    expect(`${r.stdout}${r.stderr}`).not.toMatch(NO_CRASH);
    expect(readdirSync(cwd)).toEqual([]);
  }, 30_000);

  test("stack scan --json emits { hits: [] } in an empty dir, exit 0", async () => {
    const cwd = emptyDir("stack-first-run-");
    const r = await stack(["scan", "--json"], cwd);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ hits: [] });
    expect(readdirSync(cwd)).toEqual([]);
  }, 30_000);

  test("stack scan detects providers in an existing repo, exit 0", async () => {
    const cwd = emptyDir("stack-first-run-");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { "@supabase/supabase-js": "^2.0.0", openai: "^4.0.0" },
      }),
    );
    writeFileSync(join(cwd, ".env.example"), "SENTRY_DSN=\nSTRIPE_SECRET_KEY=\n");
    const r = await stack(["scan"], cwd);
    expect(r.code).toBe(0);
    for (const name of ["openai", "supabase", "sentry", "stripe"]) {
      expect(r.stdout).toContain(name);
      expect(r.stdout).toContain(`stack add ${name}`);
    }
    expect(r.stdout).toContain("nothing written");
    // "Writes nothing": no .stack.toml, no .stack/ recipes, only the seeds remain.
    expect(readdirSync(cwd).sort()).toEqual([".env.example", "package.json"]);
  }, 30_000);
});

describe("stack <command> --help for every command the README names", () => {
  test("every README command prints its own usage page and exits 0", async () => {
    const names = readmeCommands();
    const results = await mapPool(names, 8, async (name) => {
      const r = await stack([name, "--help"], emptyDir("stack-first-run-"));
      const usage = new RegExp(`USAGE stack ${name}(\\s|$)`).test(r.stdout);
      const crashed = NO_CRASH.test(`${r.stdout}${r.stderr}`);
      return { name, code: r.code, usage, crashed };
    });
    for (const r of results) {
      expect(r.code, `stack ${r.name} --help exit code`).toBe(0);
      expect(r.usage, `stack ${r.name} --help prints its own USAGE line`).toBe(true);
      expect(r.crashed, `stack ${r.name} --help must not crash`).toBe(false);
    }
    expect(results).toHaveLength(names.length);
  }, 300_000);

  test("the README names every registered command", () => {
    // Guardrail in the other direction: a command added to the registry but not
    // to the README table would leave --help coverage silently incomplete.
    const indexSource = readFileSync(join(SRC_DIR, "index.ts"), "utf8");
    const registry = indexSource.match(/subCommands:\s*\{([\s\S]*?)\n {2}\},/);
    if (!registry) throw new Error("index.ts has no subCommands registry");
    const registered = [...registry[1].matchAll(/^\s+"?([a-z0-9-]+)"?:\s*\(\)/gm)].map((m) => m[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect([...registered].sort()).toEqual([...readmeCommands()].sort());
  });
});
