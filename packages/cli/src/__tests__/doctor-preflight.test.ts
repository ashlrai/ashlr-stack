import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `stack doctor` with the opt-in STACK_PHANTOM_PREFLIGHT, against a fake phantom. */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const created: string[] = [];
afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});
function tmp(p: string): string {
  const d = mkdtempSync(join(tmpdir(), p));
  created.push(d);
  return d;
}

function doc(verdict: string, blockedBy: string[] = []): string {
  return JSON.stringify({
    schema_version: 1,
    kind: "phantom.agent.preflight",
    verdict,
    readiness: "protected",
    risk_level: "medium",
    vault_probed: false,
    checks: [],
    wrap: { exec_ready: blockedBy.length === 0, blocked_by: blockedBy },
  });
}

function doctor(
  env: Record<string, string>,
  json: string,
  exit: number,
  args: string[] = ["--json"],
) {
  const bin = tmp("stack-docpf-bin-");
  writeFileSync(join(bin, "pf.json"), json);
  writeFileSync(
    join(bin, "phantom"),
    `#!/bin/sh
case "$1" in
  --version) echo "phantom 0.7.9" ;;
  agent) cat "${join(bin, "pf.json")}"; exit ${exit} ;;
  *) echo "[]" ;;
esac
`,
  );
  chmodSync(join(bin, "phantom"), 0o755);
  const cwd = tmp("stack-docpf-proj-");
  writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n\n[services]\n');
  writeFileSync(join(cwd, ".stack.local.toml"), '[stack]\nproject_id = "stk_test01"\n');
  const r = spawnSync("bun", [CLI_ENTRY, "doctor", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: cwd,
      NO_COLOR: "1",
      CI: "1",
      STACK_NO_UPDATE_CHECK: "1",
      STACK_NO_TELEMETRY: "1",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      ...env,
    },
    timeout: 30_000,
  });
  return { code: r.status, stdout: r.stdout ?? "" };
}

describe.skipIf(process.platform === "win32")("stack doctor phantom preflight", () => {
  test("off by default: no phantom_preflight field", () => {
    const r = doctor({ STACK_PHANTOM_PREFLIGHT: "" }, doc("blocked", ["x-y"]), 1);
    expect(JSON.parse(r.stdout).phantom_preflight).toBeUndefined();
    expect(r.code).toBe(0);
  });

  test("on: blocked fails doctor and reports only ids", () => {
    const r = doctor({ STACK_PHANTOM_PREFLIGHT: "1" }, doc("blocked", ["unprotected-env-file"]), 1);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).phantom_preflight).toEqual({
      verdict: "blocked",
      blocked_by: ["unprotected-env-file"],
      refuse: true,
    });
  });

  test("on: degraded is reported but does not fail", () => {
    const r = doctor({ STACK_PHANTOM_PREFLIGHT: "1" }, doc("degraded"), 2);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).phantom_preflight.verdict).toBe("degraded");
  });

  test("strict: degraded fails", () => {
    const r = doctor({ STACK_PHANTOM_PREFLIGHT: "strict" }, doc("degraded"), 2);
    expect(r.code).toBe(1);
  });

  test("an old phantom without agent doctor only warns", () => {
    const r = doctor({ STACK_PHANTOM_PREFLIGHT: "strict" }, "error: unrecognized subcommand", 2);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).phantom_preflight).toEqual({
      verdict: null,
      blocked_by: [],
      refuse: false,
    });
  });

  test("human output prints the verdict line", () => {
    const r = doctor(
      { STACK_PHANTOM_PREFLIGHT: "1" },
      doc("blocked", ["unprotected-env-file"]),
      1,
      [],
    );
    expect(r.stdout).toContain("phantom preflight: blocked (unprotected-env-file)");
  });
});
