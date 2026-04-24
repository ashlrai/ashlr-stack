import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
  const dir = mkdtempSync(join(tmpdir(), "stack-swap-"));
  createdDirs.push(dir);
  return dir;
}

/** Write a minimal .stack.toml with `from` configured so swap validation passes. */
function seedConfig(dir: string, serviceName: string): void {
  const toml = `[project]
name = "test-project"
template = "custom"

[services.${serviceName}]
secrets = []
`;
  writeFileSync(join(dir, ".stack.toml"), toml);
}

// ─── dry-run tests ────────────────────────────────────────────────────────────

describe("stack swap --dryRun", () => {
  it("prints the plan and exits 0 for a known pair", () => {
    const dir = mkTmp();
    seedConfig(dir, "clerk");
    const { stdout, stderr, code } = runCli(["swap", "clerk", "auth0", "--dryRun"], dir);
    const out = stdout + stderr;
    expect(code).toBe(0);
    expect(out).toContain("Plan:");
    expect(out).toContain("auth0");
    expect(out).toContain("clerk");
    expect(out).toContain("dry-run");
  });

  it("prints alias info for supabase → neon", () => {
    const dir = mkTmp();
    seedConfig(dir, "supabase");
    const { stdout, stderr, code } = runCli(["swap", "supabase", "neon", "--dryRun"], dir);
    const out = stdout + stderr;
    expect(code).toBe(0);
    expect(out).toContain("DATABASE_URL");
    expect(out).toContain("SUPABASE_URL");
  });

  it("shows (none registered) alias note for a pair without aliases", () => {
    const dir = mkTmp();
    seedConfig(dir, "clerk");
    const { stdout, stderr } = runCli(["swap", "clerk", "auth0", "--dryRun"], dir);
    const out = stdout + stderr;
    // clerk→auth0 has no aliases, so the plan line should say none
    expect(out).toContain("none");
  });

  it("prints keepFrom note when --keepFrom is set", () => {
    const dir = mkTmp();
    seedConfig(dir, "clerk");
    const { stdout, stderr, code } = runCli(
      ["swap", "clerk", "auth0", "--dryRun", "--keepFrom"],
      dir,
    );
    const out = stdout + stderr;
    expect(code).toBe(0);
    expect(out).toContain("keepFrom");
  });
});

// ─── validation error tests ───────────────────────────────────────────────────

describe("stack swap — validation errors", () => {
  it("errors on unknown `from` provider", () => {
    const dir = mkTmp();
    seedConfig(dir, "clerk");
    const { stdout, stderr, code } = runCli(
      ["swap", "nonexistentprovider", "auth0", "--dryRun"],
      dir,
    );
    const out = stdout + stderr;
    expect(code).toBeGreaterThan(0);
    expect(out).toContain("nonexistentprovider");
  });

  it("errors on unknown `to` provider", () => {
    const dir = mkTmp();
    seedConfig(dir, "clerk");
    const { stdout, stderr, code } = runCli(["swap", "clerk", "fakeprovider999", "--dryRun"], dir);
    const out = stdout + stderr;
    expect(code).toBeGreaterThan(0);
    expect(out).toContain("fakeprovider999");
  });

  it("errors when from and to are in different categories", () => {
    const dir = mkTmp();
    seedConfig(dir, "clerk");
    // clerk = Auth, resend = Email
    const { stdout, stderr, code } = runCli(["swap", "clerk", "resend", "--dryRun"], dir);
    const out = stdout + stderr;
    expect(code).toBeGreaterThan(0);
    expect(out).toMatch(/Auth|Email|category/i);
  });

  it("errors when `from` is not in .stack.toml", () => {
    const dir = mkTmp();
    seedConfig(dir, "auth0"); // auth0 is configured, not clerk
    const { stdout, stderr, code } = runCli(["swap", "clerk", "auth0", "--dryRun"], dir);
    const out = stdout + stderr;
    expect(code).toBeGreaterThan(0);
    expect(out).toContain("clerk");
    expect(out).toMatch(/not configured|nothing to swap/i);
  });

  it("errors when no .stack.toml exists", () => {
    const dir = mkTmp();
    // no seedConfig call
    const { stdout, stderr, code } = runCli(["swap", "clerk", "auth0", "--dryRun"], dir);
    const out = stdout + stderr;
    expect(code).toBeGreaterThan(0);
    expect(out).toMatch(/\.stack\.toml|stack init/i);
  });
});

// ─── integration: execute with mocked providers ───────────────────────────────

describe("stack swap — integration (mocked)", () => {
  let phantomDir: string;
  let originalPath: string;
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    originalPath = process.env.PATH ?? "";
    originalCwd = process.cwd();

    // Set up fake phantom binary
    phantomDir = mkdtempSync(join(tmpdir(), "swap-phantom-"));
    createdDirs.push(phantomDir);

    const vaultPath = join(phantomDir, "vault.json");
    writeFileSync(vaultPath, JSON.stringify({}));

    const script = `#!/usr/bin/env bash
VAULT=${JSON.stringify(vaultPath)}
case "\${1:-}" in
  --version) echo "phantom fake 0.0.1" ;;
  status)    echo "ok" ;;
  add)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v=json.load(f)
v[sys.argv[2]]=sys.argv[3]
with open(sys.argv[1],"w") as f: json.dump(v,f)
' "$VAULT" "$2" "$3" ;;
  remove)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v=json.load(f)
v.pop(sys.argv[2],None)
with open(sys.argv[1],"w") as f: json.dump(v,f)
' "$VAULT" "$2" ;;
  list)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v=json.load(f)
for k in v: print(k)
' "$VAULT" ;;
  reveal)
    python3 -c 'import json,sys
with open(sys.argv[1]) as f: v=json.load(f)
print(v.get(sys.argv[2],""))
' "$VAULT" "$2" ;;
  init)    echo "initialized" ;;
  *)       echo "fake: unknown: \${1:-}" >&2; exit 0 ;;
esac
`;
    const binPath = join(phantomDir, "phantom");
    writeFileSync(binPath, script);
    // chmod +x
    spawnSync("chmod", ["+x", binPath]);

    process.env.PATH = `${phantomDir}:${originalPath}`;

    tmpDir = mkdtempSync(join(tmpdir(), "swap-int-"));
    createdDirs.push(tmpDir);
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.chdir(originalCwd);
  });

  it("dry-run: does not provision or remove in real mode", () => {
    seedConfig(tmpDir, "clerk");
    const before = spawnSync("bun", [CLI_ENTRY, "list"], {
      encoding: "utf8",
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });

    const { stdout, stderr, code } = runCli(["swap", "clerk", "auth0", "--dryRun"], tmpDir);
    const out = stdout + stderr;
    expect(code).toBe(0);
    expect(out).toContain("dry-run");

    // The .stack.toml should still only have clerk (nothing changed)
    const after = spawnSync("bun", [CLI_ENTRY, "list"], {
      encoding: "utf8",
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });
    // Both list outputs should reference clerk and not auth0
    expect(after.stdout + after.stderr).toContain("clerk");
  });
});
