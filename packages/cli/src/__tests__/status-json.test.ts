import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatusReport } from "../commands/status.ts";

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

type VaultMode = "two" | "empty" | "error";

/**
 * A bin dir holding only an optional fake `phantom`, so the result does not
 * depend on whether the host has Phantom Secrets installed. The fake mirrors
 * real Phantom Secrets output (crates/phantom-cli/src/commands/list.rs):
 * `phantom list` prints a `-> N secret(s) in vault (...)` header, indented
 * names and a trailing note, or `! No secrets stored.`; `phantom list --json`
 * prints a pretty JSON array. Mode "error" is the no-.phantom.toml case:
 * an error on stderr and exit 1.
 */
function binDir(vault: VaultMode | false): string {
  const dir = tmp("stack-status-bin-");
  if (vault) {
    const human =
      vault === "two"
        ? [
            "-> 2 secret(s) in vault (keychain):",
            "",
            "   - OPENAI_API_KEY  (openai)",
            "   - SUPABASE_URL",
            "",
            "note Values are never displayed. Use phantom add/remove to manage.",
          ]
        : ["! No secrets stored."];
    const json =
      vault === "two"
        ? [
            "[",
            "  {",
            '    "name": "OPENAI_API_KEY",',
            '    "detected_service": "openai"',
            "  },",
            "  {",
            '    "name": "SUPABASE_URL",',
            '    "detected_service": null',
            "  }",
            "]",
          ]
        : ["[]"];
    const lines = [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "phantom 0.7.9"; exit 0; fi',
      'if [ "$1" = "list" ]; then',
    ];
    if (vault === "error") {
      lines.push("  echo 'Error: No .phantom.toml found. Run phantom init first.' >&2", "  exit 1");
    } else {
      lines.push(
        `  case " $* " in *" --json "*) cat <<'EOF'`,
        ...json,
        "EOF",
        "  ;;",
        "  *) cat <<'EOF'",
        ...human,
        "EOF",
        "  ;; esac",
        "  exit 0",
      );
    }
    lines.push("fi", "exit 1", "");
    const fake = join(dir, "phantom");
    writeFileSync(fake, lines.join("\n"));
    chmodSync(fake, 0o755);
  }
  return dir;
}

function runStatus(cwd: string, args: string[], vault: VaultMode | false) {
  const home = tmp("stack-status-home-");
  const result = spawnSync(process.execPath, [CLI_ENTRY, "status", ...args], {
    encoding: "utf8",
    cwd,
    env: {
      PATH: [binDir(vault), dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      HOME: home,
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
mcp = "supabase"

[services.openai]
provider = "openai"
secrets = ["OPENAI_API_KEY"]

[[environments]]
name = "dev"
default = true
`;

const STACK_LOCAL_TOML = `[stack]
project_id = "stk_test0001"

[services.supabase]
resource_id = "abcd1234"
region = "us-east-1"
created_at = "2026-01-01T00:00:00.000Z"
`;

function project(): string {
  const dir = tmp("stack-status-proj-");
  writeFileSync(join(dir, ".stack.toml"), STACK_TOML);
  writeFileSync(join(dir, ".stack.local.toml"), STACK_LOCAL_TOML);
  return dir;
}

describe("stack status --json", () => {
  test("emits services as {name,...} objects plus config and phantom fields", () => {
    const { stdout, code } = runStatus(project(), ["--json"], "two");
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.schema).toBe("ashlr.stack.status/v1");
    expect(report.config).toEqual({ present: true, project_id: "stk_test0001", template: null });
    expect(report.phantom).toEqual({ installed: true, secret_count: 2 });
    expect(report.services).toEqual([
      {
        name: "supabase",
        provider: "supabase",
        resource_id: "abcd1234",
        region: "us-east-1",
        secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
        mcp: "supabase",
      },
      {
        name: "openai",
        provider: "openai",
        resource_id: null,
        region: null,
        secrets: ["OPENAI_API_KEY"],
        mcp: null,
      },
    ]);
  });

  test("matches the consumer contract: services[].name is parseable", () => {
    // Mirrors Phantom's stackStatus() parser (src/core/integrations/stack.ts).
    const { stdout } = runStatus(project(), ["--json"], "two");
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const raw = parsed.services;
    expect(Array.isArray(raw)).toBe(true);
    const names = (raw as Array<{ name?: unknown }>)
      .map((s) => s.name)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    expect(names).toEqual(["supabase", "openai"]);
  });

  test("empty vault reports secret_count 0", () => {
    const { stdout, code } = runStatus(project(), ["--json"], "empty");
    expect(code).toBe(0);
    expect(JSON.parse(stdout).phantom).toEqual({ installed: true, secret_count: 0 });
  });

  test("unreadable vault (phantom list exits 1) reports secret_count null", () => {
    const { stdout, code } = runStatus(project(), ["--json"], "error");
    expect(code).toBe(0);
    expect(JSON.parse(stdout).phantom).toEqual({ installed: true, secret_count: null });
  });

  test("no .stack.toml: exits 0 with empty services and present=false", () => {
    const { stdout, code } = runStatus(tmp("stack-status-empty-"), ["--json"], false);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.config.present).toBe(false);
    expect(report.config.project_id).toBeNull();
    expect(report.phantom).toEqual({ installed: false, secret_count: null });
    expect(report.services).toEqual([]);
  });

  test("unreadable .stack.toml: JSON error on stdout and exit 1", () => {
    const dir = tmp("stack-status-bad-");
    writeFileSync(join(dir, ".stack.toml"), "[stack\nnot toml");
    const { stdout, code } = runStatus(dir, ["--json"], false);
    expect(code).toBe(1);
    expect(typeof JSON.parse(stdout).error).toBe("string");
  });

  test("human output is unchanged without --json", () => {
    const { stdout, code } = runStatus(project(), [], "two");
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain("Ashlr Stack");
    expect(stdout).toContain(".stack.toml       stk_test0001");
    expect(stdout).toContain("phantom           2 secrets in vault");
    expect(stdout).toContain("services          2 configured");
    expect(stdout).toMatch(/· supabase\s+abcd1234/);
  });
});

describe("buildStatusReport", () => {
  test("secret_count is null when Phantom is absent even if a count is passed", () => {
    const report = buildStatusReport({
      config: undefined,
      phantomInstalled: false,
      secretCount: 5,
    });
    expect(report.phantom).toEqual({ installed: false, secret_count: null });
  });

  test("an unreadable vault reports secret_count null, not 0", () => {
    const report = buildStatusReport({
      config: undefined,
      phantomInstalled: true,
      secretCount: null,
    });
    expect(report.phantom.secret_count).toBeNull();
  });
});
