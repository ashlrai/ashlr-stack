import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/**
 * A bin dir with an optional fake `phantom`. Real Phantom Secrets (>= 0.7.3)
 * refuses `phantom remove` without an attached terminal and exits non-zero;
 * the fake does the same, except for names listed in `removable`.
 */
function binDir(phantom: { removable: string[] } | false): string {
  const dir = tmp("stack-remove-bin-");
  if (phantom) {
    const cases = phantom.removable.map((name) => `    ${name}) exit 0 ;;`);
    const script = [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "phantom 0.7.9"; exit 0; fi',
      'if [ "$1" = "remove" ]; then',
      '  case "$2" in',
      ...cases,
      "    *) echo 'Error: removing a secret requires an attached terminal' >&2; exit 1 ;;",
      "  esac",
      "fi",
      "exit 1",
      "",
    ].join("\n");
    const fake = join(dir, "phantom");
    writeFileSync(fake, script);
    chmodSync(fake, 0o755);
  }
  return dir;
}

function runRemove(cwd: string, args: string[], phantom: { removable: string[] } | false) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, "remove", ...args], {
    encoding: "utf8",
    cwd,
    env: {
      PATH: [binDir(phantom), dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      HOME: tmp("stack-remove-home-"),
      NO_COLOR: "1",
      CI: "1",
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
    },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status };
}

const STACK_TOML = `[stack]
version = "1"

[services.supabase]
provider = "supabase"
secrets = ["SUPABASE_URL", "SUPABASE_ANON_KEY"]

[services.openai]
provider = "openai"
secrets = ["OPENAI_API_KEY"]

[[environments]]
name = "dev"
default = true
`;

function project(): string {
  const dir = tmp("stack-remove-proj-");
  writeFileSync(join(dir, ".stack.toml"), STACK_TOML);
  return dir;
}

describe("stack remove --json", () => {
  test("reports the secrets Phantom kept instead of a banner", () => {
    const dir = project();
    const r = runRemove(dir, ["supabase", "--json"], { removable: ["SUPABASE_URL"] });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report).toEqual({
      schema: "ashlr.stack.remove/v1",
      mode: "one",
      removed: [
        {
          service: "supabase",
          secrets_removed: ["SUPABASE_URL"],
          secrets_kept: ["SUPABASE_ANON_KEY"],
          mcp_removed: null,
        },
      ],
      secrets_kept: ["SUPABASE_ANON_KEY"],
      upstream_kept: true,
      keep_remote: false,
    });
    const toml = readFileSync(join(dir, ".stack.toml"), "utf8");
    expect(toml).not.toContain("[services.supabase]");
    expect(toml).toContain("[services.openai]");
  });

  test("--all lists every service and every kept secret", () => {
    const dir = project();
    const r = runRemove(dir, ["--all", "--json"], { removable: [] });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.mode).toBe("all");
    expect(report.removed.map((s: { service: string }) => s.service).sort()).toEqual([
      "openai",
      "supabase",
    ]);
    expect(report.secrets_kept.sort()).toEqual([
      "OPENAI_API_KEY",
      "SUPABASE_ANON_KEY",
      "SUPABASE_URL",
    ]);
  });

  test("--allOrphans reports only the removed service and preserves detected services", () => {
    const dir = project();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { openai: "latest" } }),
    );
    const r = runRemove(dir, ["--allOrphans", "--keepRemote", "--json"], {
      removable: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
    });

    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      schema: "ashlr.stack.remove/v1",
      mode: "orphans",
      removed: [
        {
          service: "supabase",
          secrets_removed: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
          secrets_kept: [],
          mcp_removed: null,
        },
      ],
      secrets_kept: [],
      upstream_kept: true,
      keep_remote: true,
    });
    const toml = readFileSync(join(dir, ".stack.toml"), "utf8");
    expect(toml).not.toContain("[services.supabase]");
    expect(toml).toContain("[services.openai]");
  });

  test("an unknown service is a JSON error naming the configured ones", () => {
    const dir = project();
    const r = runRemove(dir, ["nope", "--json"], { removable: [] });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({
      error: "nope is not in this stack. Configured services: openai, supabase.",
    });
    expect(readFileSync(join(dir, ".stack.toml"), "utf8")).toBe(STACK_TOML);
  });

  test("a case-mismatched service reports a suggestion without changing the stack", () => {
    const dir = project();
    const r = runRemove(dir, ["OpenAI", "--json"], false);

    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({
      error:
        "OpenAI is not in this stack. Did you mean openai? Configured services: openai, supabase.",
    });
    expect(readFileSync(join(dir, ".stack.toml"), "utf8")).toBe(STACK_TOML);
  });

  test("missing Phantom is a JSON error and changes nothing", () => {
    const dir = project();
    const r = runRemove(dir, ["openai", "--json"], false);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("Phantom Secrets isn't installed");
    expect(readFileSync(join(dir, ".stack.toml"), "utf8")).toBe(STACK_TOML);
  });

  test("no .stack.toml is a JSON error", () => {
    const dir = tmp("stack-remove-empty-");
    const r = runRemove(dir, ["openai", "--json"], { removable: [] });
    expect(r.code).toBe(1);
    expect(typeof JSON.parse(r.stdout).error).toBe("string");
    expect(existsSync(join(dir, ".stack.toml"))).toBe(false);
  });
});
