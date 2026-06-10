import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  const dir = mkdtempSync(join(tmpdir(), "stack-add-"));
  createdDirs.push(dir);
  writeFileSync(join(dir, ".stack.toml"), '[project]\nname = "t"\ntemplate = "custom"\n');
  return dir;
}

/**
 * `add <provider> --dry-run` is the documented "safe, no-op" form. Regression
 * guard: citty 0.1.6 silently dropped the kebab spelling (the arg key is
 * `dryRun`), so `--dry-run` fell through to the real provisioning flow —
 * `provider.login()` and live network/vault writes — instead of the preview.
 *
 * We use `supabase`: its `login()` throws SUPABASE_AUTH_REQUIRED, so if the
 * dry-run branch were skipped the failure is observable and never silently
 * provisions.
 */
describe("stack add --dry-run", () => {
  const PREVIEW = "dry-run complete — nothing written.";

  it("--dry-run (kebab, the documented form) prints the preview and writes nothing", () => {
    const dir = mkTmp();
    const { stdout, stderr, code } = runCli(["add", "supabase", "--dry-run"], dir);
    const out = stdout + stderr;
    expect(code).toBe(0);
    expect(out).toContain("(dry-run)");
    expect(out).toContain(PREVIEW);
    // The 5-step plan is described, not executed.
    expect(out).toContain("login");
    expect(out).toContain("provision");
    expect(out).toContain("persist");
    // The real login() never ran, so its auth error must not appear.
    expect(out).not.toContain("SUPABASE_STACK_CLIENT_ID");
  });

  it("--dryRun (camelCase) keeps working — no regression", () => {
    const dir = mkTmp();
    const { stdout, stderr, code } = runCli(["add", "supabase", "--dryRun"], dir);
    const out = stdout + stderr;
    expect(code).toBe(0);
    expect(out).toContain(PREVIEW);
    expect(out).not.toContain("SUPABASE_STACK_CLIENT_ID");
  });

  it("without the flag, the preview branch does NOT run (dry-run is opt-in)", () => {
    const dir = mkTmp();
    const { stdout, stderr } = runCli(["add", "supabase"], dir);
    const out = stdout + stderr;
    // The dry-run/preview branch never runs: no "(dry-run)" title, no preview
    // line. (We don't assert the specific downstream error — whether it fails at
    // the Phantom preflight or the OAuth guard depends on the environment, e.g.
    // whether Phantom is installed on the CI runner.)
    expect(out).not.toContain("(dry-run)");
    expect(out).not.toContain(PREVIEW);
  });
});
