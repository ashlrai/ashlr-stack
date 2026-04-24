import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tests for `stack init` — specifically the new provisioning flags added in B2:
 *
 *   --noProvision  writes .stack.toml but skips provisioning
 *   --dryRun       prints the provision plan, no mutations
 *
 * We don't test live provisioning (real OAuth/HTTP) — the apply.test.ts suite
 * already covers that boundary. These tests stay at the config-write level.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
// Templates live at <repo-root>/templates; resolve from this test file's location:
// __tests__ → src → cli → packages → stack (repo root)
const TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "templates",
);

function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1", STACK_TEMPLATES_DIR: TEMPLATES_DIR },
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
  const dir = mkdtempSync(join(tmpdir(), "stack-init-"));
  createdDirs.push(dir);
  return dir;
}

describe("stack init", () => {
  it("blank init (no template) writes .stack.toml without provisioning", () => {
    const dir = mkTmp();
    const { code, stdout, stderr } = runCli(["init", "--noInteractive"], dir);
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".stack.toml"))).toBe(true);
    // No provisioning run for a blank init (Phantom warning may mention "stack add" but provisioning lines start with "› stack add")
    const out = stdout + stderr;
    expect(out).not.toContain("› stack add");
    expect(out).not.toContain("Provisioning");
  });

  it("--template --noProvision writes config, skips provisioning", () => {
    const dir = mkTmp();
    const { code, stdout, stderr } = runCli(
      ["init", "--template", "nextjs-supabase-posthog", "--noProvision"],
      dir,
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".stack.toml"))).toBe(true);

    // Config must contain the template's services as stubs
    const toml = readFileSync(join(dir, ".stack.toml"), "utf-8");
    expect(toml).toContain("supabase");
    expect(toml).toContain("posthog");

    // No provisioning should have run (provisioning lines start with "› stack add")
    const out = stdout + stderr;
    expect(out).not.toContain("› stack add");
  });

  it("--template --dryRun prints plan, writes config, does not provision", () => {
    const dir = mkTmp();
    const { code, stdout, stderr } = runCli(
      ["init", "--template", "nextjs-supabase-posthog", "--dryRun"],
      dir,
    );
    expect(code).toBe(0);

    // Config is written even in dry-run (shape only, no provisioning)
    expect(existsSync(join(dir, ".stack.toml"))).toBe(true);

    // Output must mention the services that would be provisioned
    const out = stdout + stderr;
    expect(out).toContain("supabase");
    expect(out).toContain("posthog");
    expect(out).toContain("Dry run");

    // No real `stack add` calls
    expect(out).not.toContain("stack add supabase");
    expect(out).not.toContain("stack add posthog");
  });

  it("--force overwrites an existing .stack.toml", () => {
    const dir = mkTmp();
    // First init
    runCli(["init", "--noInteractive"], dir);
    expect(existsSync(join(dir, ".stack.toml"))).toBe(true);

    // Second init without --force should fail
    const noForce = runCli(["init", "--noInteractive"], dir);
    expect(noForce.code).toBeGreaterThan(0);
    expect(noForce.stdout + noForce.stderr).toContain("already exists");

    // With --force should succeed
    const withForce = runCli(["init", "--noInteractive", "--force"], dir);
    expect(withForce.code).toBe(0);
  });
});
