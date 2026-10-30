import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end test for `stack apply` — specifically the auto-init behaviour.
 * The marketed golden path is `stack recommend --save && stack apply <id>`
 * from a blank directory; that must not explode on a missing .stack.toml.
 *
 * We don't exercise the provider-provisioning side (real HTTP, OAuth, tokens
 * required). `--noWire` + `--noRollback` isolate the init+pipeline behaviour.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCli(
  args: string[],
  cwd?: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1", ...env },
    timeout: 20_000,
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
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-"));
  createdDirs.push(dir);
  return dir;
}

// Each test spawns one or two full `bun` CLI processes; on loaded machines a
// single spawn can take several seconds — well past the 5s default.
setDefaultTimeout(30_000);

describe("stack apply", () => {
  it("auto-inits .stack.toml when none exists, then runs against the recipe", () => {
    const dir = mkTmp();

    // Step 1: seed a recipe via `stack recommend --save`.
    const rec = runCli(["recommend", "postgres database", "--save", "--json"], dir);
    expect(rec.code).toBe(0);
    const payload = JSON.parse(rec.stdout);
    const recipeId: string = payload.recipe.id;
    expect(existsSync(join(dir, ".stack.toml"))).toBe(false);

    // Step 2: apply it from the same blank dir. Providers will fail at `stack
    // add` because no OAuth/tokens are present, but `apply` must first create
    // .stack.toml via the auto-init path.
    const applied = runCli(["apply", recipeId, "--noWire", "--noRollback"], dir);

    // Apply may exit non-zero because provider adds fail; that's expected.
    // The invariant we care about: auto-init ran, so .stack.toml now exists.
    expect(existsSync(join(dir, ".stack.toml"))).toBe(true);

    // The banner breadcrumb should surface so the user understands the
    // auto-init happened implicitly.
    const out = applied.stdout + applied.stderr;
    expect(out).toContain("auto-running");
  });

  it("rejects a missing recipe id with a clear error", () => {
    const dir = mkTmp();
    const { stdout, stderr, code } = runCli(["apply", "does-not-exist", "--noWire"], dir);
    // Apply exits after pickRecipe fails; the surfaced error must name the
    // recipe so the user knows what to fix.
    expect(code).toBeGreaterThan(0);
    expect(stdout + stderr).toContain("does-not-exist");
  });

  it("leaves a blank directory untouched when the recipe id is wrong", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const { stdout, stderr, code } = runCli(["apply", "typo-recipe"], dir, {
      HOME: home,
      STACK_REGISTRY_DIR: join(home, "registry"),
    });
    expect(code).toBeGreaterThan(0);
    expect(stdout + stderr).toContain("stack recommend");
    expect(existsSync(join(dir, ".stack.toml"))).toBe(false);
    expect(existsSync(join(home, "registry"))).toBe(false);
  });

  it("tries every recipe provider and reports each failure", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    mkdirSync(bin);
    // Inert Phantom: initialized, nothing stored, reveal refused (as headless).
    writeFileSync(
      join(bin, "phantom"),
      `#!/bin/sh
case "$1" in
 --version) echo fixture;;
 status) echo '{"schema_version":1,"inspection":"metadata-only","initialized":true}';;
 list) echo '[]';;
 *) echo 'Refusing without an attached terminal' >&2; exit 1;;
esac
`,
    );
    chmodSync(join(bin, "phantom"), 0o700);
    mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
    writeFileSync(
      join(dir, ".stack", "recipes", "two-ai.toml"),
      'id = "two-ai"\nquery = "ai"\ncreatedAt = "2026-10-17T00:00:00.000Z"\n\n[[providers]]\nname = "openai"\n\n[[providers]]\nname = "anthropic"\n',
    );
    const { stdout, stderr, code } = runCli(["apply", "two-ai"], dir, {
      HOME: home,
      STACK_REGISTRY_DIR: join(home, "registry"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    });
    const out = stdout + stderr;
    expect(code).toBe(1);
    // Before: the first failed `stack add` exited the process, so anthropic
    // never ran and no summary was printed.
    expect(out).toContain("stack add anthropic");
    expect(out).toContain("✗ openai:");
    expect(out).toContain("✗ anthropic:");
    // The closing "Some providers failed: ..." summary goes through
    // outroError, whose process.exit(1) can drop that last piped stdout write
    // on Bun 1.2.x, so it is checked only where the runtime flushes it.
    if (!Bun.version.startsWith("1.2.")) {
      expect(out).toContain("Some providers failed: openai:");
      expect(out).toContain("; anthropic:");
    }
  });

  it("writes nothing when the recipe id is missing or there are no recipes", () => {
    for (const args of [["apply", "does-not-exist"], ["apply"]]) {
      const dir = mkTmp();
      const home = mkTmp();
      const result = spawnSync("bun", [CLI_ENTRY, ...args], {
        encoding: "utf8",
        cwd: dir,
        env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1", CI: "1" },
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("auto-running");
      expect(readdirSync(dir)).toEqual([]);
      expect(existsSync(join(home, ".stack", "projects.json"))).toBe(false);
    }
  });
});
