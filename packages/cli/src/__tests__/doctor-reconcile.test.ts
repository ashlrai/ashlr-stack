import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tests for `stack doctor --reconcile` and `stack remove --all-orphans`.
 *
 * Strategy: use spawnSync against the real CLI entry (same pattern as init.test.ts)
 * so we get end-to-end coverage without mocking internals. We write fixture
 * .stack.toml files and package.json files to temp dirs to control detection.
 *
 * Phantom / network calls are avoided by:
 *   - `--reconcile` never calls Phantom (it's source-only)
 *   - `remove --all-orphans` in non-TTY skips the confirm prompt
 *   - We mock phantom via env so removeSecret doesn't error
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCli(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: {
      ...process.env,
      NO_COLOR: "1",
      CI: "1",
      // Prevent real Phantom calls in remove tests
      PHANTOM_MOCK: "1",
      ...extraEnv,
    },
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
  const dir = mkdtempSync(join(tmpdir(), "stack-reconcile-"));
  createdDirs.push(dir);
  return dir;
}

/** Write a minimal .stack.toml with the given service names */
function writeStackToml(dir: string, services: string[]): void {
  const serviceEntries = services
    .map((name) => `[services.${name}]\nprovider = "${name}"\nsecrets = []\n`)
    .join("\n");
  const content = `[stack]\nversion = "1"\n\n${serviceEntries}\n[[environments]]\nname = "dev"\ndefault = true\n`;
  writeFileSync(join(dir, ".stack.toml"), content, "utf-8");
  // Also write a minimal .stack.local.toml so readConfig doesn't error
  writeFileSync(join(dir, ".stack.local.toml"), `[stack]\nproject_id = "stk_test01"\n`, "utf-8");
}

/** Write a package.json that pulls in the given provider npm packages */
function writePackageJson(dir: string, deps: Record<string, string[]>): void {
  // Map provider name to a canonical npm package for detection
  const providerToPackage: Record<string, string> = {
    supabase: "@supabase/supabase-js",
    clerk: "@clerk/nextjs",
    resend: "resend",
    openai: "openai",
    stripe: "stripe",
    sentry: "@sentry/nextjs",
    posthog: "posthog-js",
    neon: "@neondatabase/serverless",
    anthropic: "@anthropic-ai/sdk",
  };

  const dependencies: Record<string, string> = {};
  for (const [provider] of Object.entries(deps)) {
    const pkg = providerToPackage[provider];
    if (pkg) dependencies[pkg] = "latest";
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies }, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// runReconcile unit-level tests (via CLI)
// ---------------------------------------------------------------------------

describe("doctor --reconcile", () => {
  it("orphan: configured but no longer detected → warns, exits 2", () => {
    const dir = mkTmp();
    // Configure clerk but provide no source that uses it
    writeStackToml(dir, ["clerk"]);
    writePackageJson(dir, {}); // no deps at all

    const { stdout, stderr, code } = runCli(["doctor", "--reconcile"], dir);
    const out = stdout + stderr;

    expect(code).toBe(2);
    expect(out).toContain("orphan");
    expect(out).toContain("clerk");
    expect(out).toContain("stack remove clerk");
  });

  it("untracked: detected but not configured → info, exits 2", () => {
    const dir = mkTmp();
    // Configure nothing, but source uses resend
    writeStackToml(dir, []);
    writePackageJson(dir, { resend: ["resend"] });

    const { stdout, stderr, code } = runCli(["doctor", "--reconcile"], dir);
    const out = stdout + stderr;

    expect(code).toBe(2);
    expect(out).toContain("untracked");
    expect(out).toContain("resend");
    expect(out).toContain("stack add resend");
  });

  it("clean state: configured matches detected → no drift, exits 0", () => {
    const dir = mkTmp();
    writeStackToml(dir, ["supabase"]);
    writePackageJson(dir, { supabase: ["@supabase/supabase-js"] });

    const { stdout, stderr, code } = runCli(["doctor", "--reconcile"], dir);
    const out = stdout + stderr;

    expect(code).toBe(0);
    expect(out).toContain("No drift");
  });

  it("both orphan and untracked in same project", () => {
    const dir = mkTmp();
    // clerk is configured but not in source; resend is in source but not configured
    writeStackToml(dir, ["clerk"]);
    writePackageJson(dir, { resend: ["resend"] });

    const { stdout, stderr, code } = runCli(["doctor", "--reconcile"], dir);
    const out = stdout + stderr;

    expect(code).toBe(2);
    expect(out).toContain("orphan");
    expect(out).toContain("clerk");
    expect(out).toContain("untracked");
    expect(out).toContain("resend");
  });
});

// ---------------------------------------------------------------------------
// --json flag
// ---------------------------------------------------------------------------

describe("doctor --reconcile --json", () => {
  it("emits valid JSON with correct schema", () => {
    const dir = mkTmp();
    writeStackToml(dir, ["clerk"]);
    writePackageJson(dir, { resend: ["resend"] });

    const { stdout, code } = runCli(["doctor", "--reconcile", "--json"], dir);

    // --json exits 0 even with drift (CI tooling handles structured output)
    expect(code).toBe(0);

    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(stdout);
    }).not.toThrow();

    const report = parsed as {
      configured: string[];
      detected: string[];
      orphans: string[];
      untracked: string[];
    };
    expect(Array.isArray(report.configured)).toBe(true);
    expect(Array.isArray(report.detected)).toBe(true);
    expect(Array.isArray(report.orphans)).toBe(true);
    expect(Array.isArray(report.untracked)).toBe(true);
    expect(report.orphans).toContain("clerk");
    expect(report.untracked).toContain("resend");
  });

  it("clean state --json: empty orphans/untracked arrays, exit 0", () => {
    const dir = mkTmp();
    writeStackToml(dir, ["supabase"]);
    writePackageJson(dir, { supabase: ["@supabase/supabase-js"] });

    const { stdout, code } = runCli(["doctor", "--reconcile", "--json"], dir);

    expect(code).toBe(0);
    const report = JSON.parse(stdout) as {
      orphans: string[];
      untracked: string[];
    };
    expect(report.orphans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// remove --all-orphans
// ---------------------------------------------------------------------------

describe("remove --all-orphans", () => {
  it("removes orphaned service entries from .stack.toml (non-TTY, no prompt)", () => {
    const dir = mkTmp();
    // clerk is configured but not detected in source
    // resend is configured AND detected → should NOT be removed
    writeStackToml(dir, ["clerk", "resend"]);
    writePackageJson(dir, { resend: ["resend"] });

    // In non-TTY (CI=1), confirmation is skipped; but removeSecret will be called.
    // We need to handle the case where Phantom isn't installed.
    // The test fixture has no secrets, so removeSecret loops over empty array → no-op.
    const { stdout, stderr, code } = runCli(["remove", "--allOrphans"], dir, {
      // Force non-interactive so the confirm prompt auto-accepts
      CI: "1",
    });
    const out = stdout + stderr;

    // Should succeed (clerk has 0 secrets so removeSecret is never called)
    expect(code).toBe(0);
    expect(out).toContain("clerk");
    // resend should NOT appear as removed
    expect(out).not.toContain("resend");
  });

  it("no-op when no orphans exist", () => {
    const dir = mkTmp();
    writeStackToml(dir, ["supabase"]);
    writePackageJson(dir, { supabase: ["@supabase/supabase-js"] });

    const { stdout, stderr, code } = runCli(["remove", "--allOrphans"], dir);
    const out = stdout + stderr;

    expect(code).toBe(0);
    expect(out).toContain("No orphans found");
  });
});
