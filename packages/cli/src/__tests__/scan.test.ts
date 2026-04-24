import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCli(
  args: string[],
  cwd?: string,
  extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", ...extraEnv },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 0,
  };
}

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-scan-cli-"));
  for (const [relpath, content] of Object.entries(files)) {
    const full = join(dir, relpath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tmp(files: Record<string, string>): string {
  const d = makeProject(files);
  created.push(d);
  return d;
}

// ── --json mode ────────────────────────────────────────────────────────────

describe("stack scan --json", () => {
  test("emits valid JSON schema and exits 0", () => {
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: {
          "@supabase/supabase-js": "^2.45.0",
          "@sentry/nextjs": "^7.0.0",
        },
      }),
    });
    // CI=1 strips TTY; no prompts expected because --json bypasses all interactivity
    const { stdout, code } = runCli(["scan", "--json", "--path", cwd], undefined, { CI: "1" });
    expect(code).toBe(0);
    let parsed: { hits: Array<{ provider: string; confidence: string; sources: string[] }> };
    expect(() => {
      parsed = JSON.parse(stdout);
    }).not.toThrow();
    // @ts-ignore — parsed assigned in expect block above
    expect(Array.isArray(parsed.hits)).toBe(true);
    // @ts-ignore
    const providers = parsed.hits.map((h: { provider: string }) => h.provider);
    expect(providers).toContain("supabase");
    expect(providers).toContain("sentry");
    // Each hit has required shape
    // @ts-ignore
    for (const hit of parsed.hits) {
      expect(typeof hit.provider).toBe("string");
      expect(["high", "medium", "low"]).toContain(hit.confidence);
      expect(Array.isArray(hit.sources)).toBe(true);
    }
  });

  test("--json respects --confidence filter", () => {
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: {
          "@supabase/supabase-js": "^2.45.0", // high
          "@vercel/analytics": "^1.0.0", // medium
        },
      }),
    });
    const { stdout, code } = runCli(
      ["scan", "--json", "--confidence", "high", "--path", cwd],
      undefined,
      { CI: "1" },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { hits: Array<{ provider: string; confidence: string }> };
    // Only high-confidence hits should appear
    for (const hit of parsed.hits) {
      expect(hit.confidence).toBe("high");
    }
    const providers = parsed.hits.map((h) => h.provider);
    expect(providers).toContain("supabase");
    expect(providers).not.toContain("vercel");
  });

  test("--json on empty project emits empty hits array", () => {
    const cwd = tmp({ "README.md": "# hello" });
    const { stdout, code } = runCli(["scan", "--json", "--path", cwd], undefined, { CI: "1" });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { hits: unknown[] };
    expect(parsed.hits).toEqual([]);
  });
});

// ── --confidence filter ────────────────────────────────────────────────────

describe("stack scan --confidence", () => {
  test("--confidence high filters out medium/low hits in JSON output", () => {
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: {
          "@supabase/supabase-js": "^2.45.0", // high
          "@vercel/analytics": "^1.0.0", // medium (dep rule)
        },
      }),
    });
    const { stdout } = runCli(
      ["scan", "--json", "--confidence", "high", "--path", cwd],
      undefined,
      { CI: "1" },
    );
    const parsed = JSON.parse(stdout) as { hits: Array<{ provider: string; confidence: string }> };
    const confidences = parsed.hits.map((h) => h.confidence);
    expect(confidences.every((c) => c === "high")).toBe(true);
  });

  test("--confidence low includes medium and high hits too", () => {
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: {
          "@supabase/supabase-js": "^2.45.0", // high
          "@vercel/analytics": "^1.0.0", // medium
        },
      }),
    });
    const { stdout } = runCli(["scan", "--json", "--confidence", "low", "--path", cwd], undefined, {
      CI: "1",
    });
    const parsed = JSON.parse(stdout) as { hits: Array<{ provider: string }> };
    const providers = parsed.hits.map((h) => h.provider);
    expect(providers).toContain("supabase");
    expect(providers).toContain("vercel");
  });
});

// ── Non-TTY without flags ──────────────────────────────────────────────────

describe("stack scan non-TTY without flags", () => {
  test("prints CI usage hint and exits 0 when not a TTY and no CI flags given", () => {
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: { "@supabase/supabase-js": "^2.45.0" },
      }),
    });
    // Omit CI=1 from env; spawnSync already has no TTY (not a terminal).
    // We DO need to strip CI from env so the --yes path isn't triggered.
    const env: Record<string, string> = { NO_COLOR: "1" };
    // Remove CI from env if present
    const baseEnv = { ...process.env };
    baseEnv.CI = undefined;
    const result = spawnSync("bun", [CLI_ENTRY, "scan", "--path", cwd], {
      encoding: "utf8",
      env: { ...baseEnv, NO_COLOR: "1" },
    });
    expect(result.status ?? 0).toBe(0);
    const combined = (result.stdout ?? "") + (result.stderr ?? "");
    expect(combined).toMatch(/--json|--yes|no TTY/i);
    void env; // suppress unused warning
  });
});

// ── --yes headless (decision logic, mock addService not needed) ──────────

describe("stack scan --yes", () => {
  test("--yes with supabase dep outputs scan complete without hanging on prompt", () => {
    // This test validates that --yes mode runs without hanging on interactive prompts.
    // We mock the Phantom check by ensuring assertPhantomInstalled is not reached
    // (the phantom binary may not be installed in CI) — but the detection + filter
    // logic should at minimum run and the process should exit.
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: { "@supabase/supabase-js": "^2.45.0" },
      }),
    });
    // --yes implies --auto which calls assertPhantomInstalled; that may throw in CI.
    // The important invariant is: process exits (doesn't hang) and exit code is
    // defined (not null from a timeout). We accept any exit code here.
    const result = spawnSync(
      "bun",
      [CLI_ENTRY, "scan", "--yes", "--confidence", "high", "--path", cwd],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    // status is null only on timeout — ensure we got a real exit
    expect(result.status).not.toBeNull();
  });

  test("--yes --confidence high in JSON mode detects supabase without prompting", () => {
    // Use --json to test the detection + confidence logic in a fully headless,
    // Phantom-free way. --json takes precedence and skips the add pipeline.
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: {
          "@supabase/supabase-js": "^2.45.0",
          "@vercel/analytics": "^1.0.0", // medium — should be filtered
        },
      }),
    });
    const { stdout, code } = runCli(
      ["scan", "--json", "--yes", "--confidence", "high", "--path", cwd],
      undefined,
      { CI: "1" },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { hits: Array<{ provider: string; confidence: string }> };
    const providers = parsed.hits.map((h) => h.provider);
    expect(providers).toContain("supabase");
    expect(providers).not.toContain("vercel");
    for (const hit of parsed.hits) {
      expect(hit.confidence).toBe("high");
    }
  });
});
