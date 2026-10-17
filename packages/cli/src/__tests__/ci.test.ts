import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCli(args: string[], opts: { stackToml?: string } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "stack-ci-cmd-"));
  try {
    if (opts.stackToml) writeFileSync(join(cwd, ".stack.toml"), opts.stackToml);
    const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: cwd, NO_COLOR: "1", STACK_NO_TELEMETRY: "1" },
    });
    return {
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      code: r.status ?? 0,
      wroteGithub: existsSync(join(cwd, ".github")),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const STACK_TOML = '[stack]\nversion = "1"\n';

describe("stack ci is an honest refusal, not a help dead end", () => {
  test("bare `stack ci` says what to run instead and exits 1", () => {
    const r = runCli(["ci"], { stackToml: STACK_TOML });
    const out = r.stdout + r.stderr;
    expect(r.code).toBe(1);
    expect(out).not.toContain("No command specified");
    expect(out).toContain("CI health workflow unavailable");
    expect(out).toContain("stack doctor");
    expect(r.wroteGithub).toBe(false);
  });

  test("`stack ci --json` emits a single { error } object and exits 1", () => {
    const r = runCli(["ci", "--json"], { stackToml: STACK_TOML });
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout.trim()) as { error: string };
    expect(parsed.error).toContain("CI health workflow unavailable");
    expect(parsed.error).toContain("stack doctor");
  });

  test("`stack ci init --json` emits { error } and exits 1", () => {
    const r = runCli(["ci", "init", "--json"], { stackToml: STACK_TOML });
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout.trim()) as { error: string };
    expect(parsed.error).toContain("stack doctor");
    expect(r.wroteGithub).toBe(false);
  });

  test("`stack ci init` names the alternative in its refusal", () => {
    const r = runCli(["ci", "init"], { stackToml: STACK_TOML });
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain("stack doctor --reconcile --json");
  });

  test("`stack ci init --json` without config still reports JSON", () => {
    const r = runCli(["ci", "init", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout.trim())).toEqual({
      error: "No .stack.toml found. Run `stack init` first.",
    });
  });
});
