import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tests for `stack env export --example` (T3).
 *
 * Providers with empty `secrets` arrays still emit a header comment but no
 * key lines — this preserves documentation value without polluting the file.
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

/** Write a minimal .stack.toml with supabase + posthog services. */
function writeStackToml(dir: string, extra?: string) {
  writeFileSync(
    join(dir, ".stack.toml"),
    `# Ashlr Stack — committed shape.
[stack]
version = "1"

[services.supabase]
provider = "supabase"
secrets = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]

[services.posthog]
provider = "posthog"
secrets = ["POSTHOG_PERSONAL_API_KEY"]
${extra ?? ""}
`,
  );
  writeFileSync(join(dir, ".stack.local.toml"), `[stack]\nproject_id = "stk_test01"\n`);
}

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-env-export-test-"));
  createdDirs.push(dir);
  return dir;
}

describe("stack env export --example --stdout", () => {
  it("emits key=empty lines grouped by provider", () => {
    const dir = makeTmp();
    writeStackToml(dir);

    const { stdout, code } = runCli(["env", "export", "--stdout"], dir);
    expect(code).toBe(0);

    // Supabase block
    expect(stdout).toContain("Supabase");
    expect(stdout).toContain("SUPABASE_URL=");
    expect(stdout).toContain("SUPABASE_ANON_KEY=");
    expect(stdout).toContain("SUPABASE_SERVICE_ROLE_KEY=");

    // PostHog block
    expect(stdout).toContain("PostHog");
    expect(stdout).toContain("POSTHOG_PERSONAL_API_KEY=");

    // No values — only bare `KEY=`
    const lines = stdout.split("\n").filter((l) => l.includes("="));
    for (const line of lines) {
      // Must be `KEY=` with nothing after the equals sign
      expect(line).toMatch(/^[A-Z_]+=$/);
    }
  });

  it("preserves service order from .stack.toml", () => {
    const dir = makeTmp();
    writeStackToml(dir);

    const { stdout } = runCli(["env", "export", "--stdout"], dir);
    const supabasePos = stdout.indexOf("Supabase");
    const posthogPos = stdout.indexOf("PostHog");
    expect(supabasePos).toBeGreaterThanOrEqual(0);
    expect(posthogPos).toBeGreaterThan(supabasePos);
  });
});

describe("stack env export --example (file write)", () => {
  it("writes .env.example to cwd", () => {
    const dir = makeTmp();
    writeStackToml(dir);

    const { code } = runCli(["env", "export"], dir);
    expect(code).toBe(0);

    const examplePath = join(dir, ".env.example");
    expect(existsSync(examplePath)).toBe(true);
    const content = readFileSync(examplePath, "utf-8");
    expect(content).toContain("SUPABASE_URL=");
    expect(content).toContain("POSTHOG_PERSONAL_API_KEY=");
  });

  it("refuses to overwrite without --force", () => {
    const dir = makeTmp();
    writeStackToml(dir);
    writeFileSync(join(dir, ".env.example"), "# existing\n");

    const { code, stdout, stderr } = runCli(["env", "export"], dir);
    // Should exit non-zero or print error
    const output = stdout + stderr;
    expect(output).toContain("--force");
    // File must be unchanged
    expect(readFileSync(join(dir, ".env.example"), "utf-8")).toBe("# existing\n");
  });

  it("overwrites with --force", () => {
    const dir = makeTmp();
    writeStackToml(dir);
    writeFileSync(join(dir, ".env.example"), "# existing\n");

    const { code } = runCli(["env", "export", "--force"], dir);
    expect(code).toBe(0);

    const content = readFileSync(join(dir, ".env.example"), "utf-8");
    expect(content).toContain("SUPABASE_URL=");
    expect(content).not.toContain("# existing");
  });
});

describe("provider with empty secrets array", () => {
  it("still emits a header comment but no key lines for unknown providers", () => {
    const dir = makeTmp();
    // Use a provider name not in the catalog so ref is undefined and entry.secrets
    // (empty array) is used directly. This tests the "skip body, keep header" path.
    writeFileSync(
      join(dir, ".stack.toml"),
      `[stack]\nversion = "1"\n\n[services.custom]\nprovider = "custom-unknown"\nsecrets = []\n`,
    );
    writeFileSync(join(dir, ".stack.local.toml"), `[stack]\nproject_id = "stk_test02"\n`);

    const { stdout, code } = runCli(["env", "export", "--stdout"], dir);
    expect(code).toBe(0);
    // Header present (falls back to provider name since not in catalog)
    expect(stdout).toContain("custom-unknown");
    // No KEY= lines
    const keyLines = stdout.split("\n").filter((l) => /^[A-Z_]+=/.test(l));
    expect(keyLines).toHaveLength(0);
  });

  it("catalog secrets win over empty toml secrets array", () => {
    const dir = makeTmp();
    // modal is in the catalog with secrets: ["MODAL_TOKEN"] — even if toml says []
    // the catalog wins, so MODAL_TOKEN= appears in output.
    writeFileSync(
      join(dir, ".stack.toml"),
      `[stack]\nversion = "1"\n\n[services.modal]\nprovider = "modal"\nsecrets = []\n`,
    );
    writeFileSync(join(dir, ".stack.local.toml"), `[stack]\nproject_id = "stk_test03"\n`);

    const { stdout, code } = runCli(["env", "export", "--stdout"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain("Modal");
    expect(stdout).toContain("MODAL_TOKEN=");
  });
});
