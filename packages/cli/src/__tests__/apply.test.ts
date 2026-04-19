import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-"));
  createdDirs.push(dir);
  return dir;
}

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
});
