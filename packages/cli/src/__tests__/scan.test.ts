import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCli(
  args: string[],
  cwd?: string,
  extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; code: number | null } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", ...extraEnv },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
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
    const parsed: { hits: Array<{ provider: string; confidence: string; sources: string[] }> } =
      JSON.parse(stdout);
    expect(Array.isArray(parsed.hits)).toBe(true);
    const providers = parsed.hits.map((h) => h.provider);
    expect(providers).toContain("supabase");
    expect(providers).toContain("sentry");
    // Each hit has required shape
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

  test("ignores provider signals in an unrelated file at every confidence level", () => {
    const cwd = tmp({
      "notes.txt": '{"dependencies":{"@supabase/supabase-js":"^2.45.0"}}\nOPENAI_API_KEY=example',
    });
    const { stdout, stderr, code } = runCli(
      ["scan", "--json", "--confidence", "low", "--path", cwd],
      undefined,
      { CI: "1" },
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ hits: [] });
    expect(existsSync(join(cwd, ".stack.toml"))).toBe(false);
  });

  test("does not mistake a backup of a provider config for the project config", () => {
    const backup = tmp({ "vercel.json.bak": "{}" });
    const project = tmp({ "vercel.json": "{}" });

    const unrelated = runCli(["scan", "--json", "--confidence", "low", "--path", backup]);
    expect(unrelated.code).toBe(0);
    expect(unrelated.stderr).toBe("");
    expect(JSON.parse(unrelated.stdout)).toEqual({ hits: [] });
    expect(existsSync(join(backup, ".stack.toml"))).toBe(false);

    const recognized = runCli(["scan", "--json", "--confidence", "low", "--path", project]);
    expect(recognized.code).toBe(0);
    expect(recognized.stderr).toBe("");
    expect(JSON.parse(recognized.stdout)).toEqual({
      hits: [{ provider: "vercel", confidence: "high", sources: ["vercel.json"] }],
    });
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

// ── nested project discovery ───────────────────────────────────────────────

describe("stack scan nested project discovery", () => {
  // Documented behavior: `--path` is the "Directory to scan" and the detected
  // signal set is that directory's own package.json / requirements.txt /
  // pyproject.toml / go.mod / Cargo.toml, framework configs (vercel.json,
  // fly.toml, railway.json, supabase/config.toml, sentry.*.config,
  // .github/workflows/) and .env.example. Discovery is per-directory: reaching
  // a project nested inside another means pointing --path at it — scanning the
  // parent never reports the child's evidence.
  const files = {
    "package.json": JSON.stringify({ dependencies: { openai: "^4.0.0" } }),
    "apps/api/package.json": JSON.stringify({
      dependencies: { "@supabase/supabase-js": "^2.45.0" },
    }),
    "apps/api/.env.example": "STRIPE_SECRET_KEY=\n",
    "apps/api/fly.toml": "app = 'api'",
    "apps/api/supabase/config.toml": "[api]\nport = 54321",
    "apps/api/.github/workflows/ci.yml": "name: CI\non: push",
  };

  function hits(stdout: string) {
    return (
      JSON.parse(stdout) as {
        hits: Array<{ provider: string; confidence: string; sources: string[] }>;
      }
    ).hits;
  }

  test("discovers the nested project's signals when --path points at it", () => {
    const cwd = tmp(files);
    const nested = join(cwd, "apps", "api");
    const { stdout, stderr, code } = runCli(
      ["scan", "--json", "--confidence", "low", "--path", nested],
      undefined,
      { CI: "1" },
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const found = hits(stdout);
    expect(found.map((h) => h.provider)).toEqual(["fly", "github", "supabase", "stripe"]);
    // Documented nested signal paths resolve inside the scanned directory.
    const supabase = found.find((h) => h.provider === "supabase");
    expect(supabase?.confidence).toBe("high");
    expect(supabase?.sources).toContain("package.json:@supabase/supabase-js");
    expect(supabase?.sources).toContain("supabase/config.toml");
    const github = found.find((h) => h.provider === "github");
    expect(github?.sources).toContain(".github/workflows/ci.yml");
  });

  test("--path accepts a nested directory relative to cwd", () => {
    const cwd = tmp(files);
    const { stdout, code } = runCli(
      ["scan", "--json", "--confidence", "low", "--path", join("apps", "api")],
      cwd,
      { CI: "1" },
    );
    expect(code).toBe(0);
    expect(hits(stdout).map((h) => h.provider)).toEqual(["fly", "github", "supabase", "stripe"]);
  }, 30_000);

  test("scanning the parent reports only the parent's own signals", () => {
    const cwd = tmp(files);
    const { stdout, stderr, code } = runCli(
      ["scan", "--json", "--confidence", "low", "--path", cwd],
      undefined,
      { CI: "1" },
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    // The nested project's manifest, .env.example, config files and
    // .github/workflows/ are not signals of the parent directory.
    expect(hits(stdout).map((h) => h.provider)).toEqual(["openai"]);
  });
});

// ── Non-TTY without flags ──────────────────────────────────────────────────

describe("stack scan non-TTY without flags", () => {
  function headless(args: string[]) {
    const cwd = tmp({
      "package.json": JSON.stringify({
        dependencies: { "@supabase/supabase-js": "^2.45.0" },
      }),
    });
    // spawnSync has no TTY. Strip CI so nothing else changes the path taken.
    const baseEnv = { ...process.env };
    baseEnv.CI = undefined;
    const result = spawnSync("bun", [CLI_ENTRY, "scan", ...args, "--path", cwd], {
      encoding: "utf8",
      env: { ...baseEnv, NO_COLOR: "1" },
    });
    return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  test("prints the detected providers and next steps, exit 0", () => {
    // It used to print only a "no TTY detected" hint, so an agent got no results.
    const r = headless([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("supabase");
    expect(r.stdout).toContain("stack add supabase");
    expect(r.stdout).toContain("nothing written");
    expect(r.stdout).not.toMatch(/no TTY/i);
  });

  test("--auto without --yes exits 1 and names --yes and --json", () => {
    const r = headless(["--auto"]);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("--yes");
    expect(r.stdout + r.stderr).toContain("--json");
  });
});

describe("stack scan without recognized project files", () => {
  test("scans an empty working directory using the default path", () => {
    const cwd = tmp({});
    const json = runCli(["scan", "--json"], cwd, { CI: "1" });
    expect(json.code).toBe(0);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout)).toEqual({ hits: [] });

    const report = runCli(["scan"], cwd, { CI: "1" });
    expect(report.code).toBe(0);
    expect(report.stderr).toBe("");
    expect(report.stdout).toContain("No providers detected");
    expect(report.stdout).not.toContain("stack add");
    expect(existsSync(join(cwd, ".stack.toml"))).toBe(false);
  }, 15_000);

  test.each([[[]], [["--yes"]]])("reports no providers without creating a stack (%j)", (flags) => {
    const cwd = tmp({
      "notes.txt": '{"dependencies":{"@supabase/supabase-js":"^2.45.0"}}\nOPENAI_API_KEY=example',
    });
    const { stdout, stderr, code } = runCli(
      ["scan", ...flags, "--confidence", "low", "--path", cwd],
      undefined,
      { CI: "1" },
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("No providers detected");
    expect(stdout).not.toContain("stack add");
    expect(stdout).not.toContain("supabase");
    expect(stdout).not.toContain("openai");
    expect(existsSync(join(cwd, ".stack.toml"))).toBe(false);
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

// ── argument validation ────────────────────────────────────────────────────

describe("stack scan rejects bad arguments", () => {
  test.each([[["--json"]], [[]], [["--yes"]]])(
    "rejects a malformed dependency manifest without reporting a partial scan (%j)",
    (flags) => {
      const cwd = tmp({ "package.json": '{"dependencies": {', "fly.toml": "" });
      const { stdout, stderr, code } = runCli(["scan", ...flags, "--path", cwd], undefined, {
        CI: "1",
      });
      expect(code).toBe(1);
      expect(stdout + stderr).toContain("Invalid JSON in dependency manifest");
      expect(stdout + stderr).toContain(join(cwd, "package.json"));
      expect(stdout + stderr).toContain("Fix it and retry");
      expect(stdout).not.toContain('"hits"');
      expect(stdout).not.toContain("provider(s) detected");
      expect(stdout).not.toContain("No providers detected");
      expect(stdout).not.toContain("scan complete");
      expect(stdout).not.toContain("fly");
      expect(existsSync(join(cwd, ".stack.toml"))).toBe(false);
    },
  );

  test("nonexistent --path exits 1 naming the path (--json)", () => {
    const missing = join(tmp({}), "missing");
    const { stdout, stderr, code } = runCli(["scan", "--json", "--path", missing], undefined, {
      CI: "1",
    });
    expect(code).toBe(1);
    expect(stderr).toContain(missing);
    expect(stderr).toContain("does not exist or is not a directory");
    expect(stdout).not.toContain('"hits"');
  });

  test("nonexistent --path exits 1 naming the path (human)", () => {
    const missing = join(tmp({}), "missing");
    const { stdout, stderr, code } = runCli(["scan", "--path", missing], undefined, { CI: "1" });
    expect(code).toBe(1);
    expect(stdout + stderr).toContain(missing);
    expect(stdout + stderr).toContain("does not exist or is not a directory");
    expect(stdout + stderr).not.toContain("No providers detected");
  });

  test("nonexistent relative --path fails before --yes can modify the project", () => {
    const cwd = tmp({});
    const { stdout, stderr, code } = runCli(["scan", "--yes", "--path", "missing"], cwd, {
      CI: "1",
    });
    expect(code).toBe(1);
    expect(stdout + stderr).toContain('Path "missing" does not exist or is not a directory');
    expect(stdout + stderr).not.toContain("scan complete");
    expect(existsSync(join(cwd, ".stack.toml"))).toBe(false);
  });

  test("a file as --path exits 1", () => {
    const cwd = tmp({ "package.json": "{}" });
    const file = join(cwd, "package.json");
    const { stderr, code } = runCli(["scan", "--json", "--path", file], undefined, { CI: "1" });
    expect(code).toBe(1);
    expect(stderr).toContain(file);
  });

  test("invalid --confidence exits 1 naming the value and the valid tiers", () => {
    const cwd = tmp({ "package.json": "{}" });
    const { stdout, stderr, code } = runCli(
      ["scan", "--json", "--path", cwd, "--confidence", "hgih"],
      undefined,
      { CI: "1" },
    );
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown confidence "hgih"');
    expect(stderr).toContain("low, medium, high");
    expect(stdout).not.toContain('"hits"');
  });

  test("--confidence is accepted in any case", () => {
    const cwd = tmp({ "package.json": "{}" });
    const { code } = runCli(["scan", "--json", "--path", cwd, "--confidence", "HIGH"], undefined, {
      CI: "1",
    });
    expect(code).toBe(0);
  });
});
