import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type PreflightRunner, preflightMode, runAgentPreflight } from "../lib/agent-preflight.ts";

function doc(verdict: string, blockedBy: string[] = []) {
  return JSON.stringify({
    schema_version: 1,
    kind: "phantom.agent.preflight",
    verdict,
    readiness: verdict === "unknown" ? null : "protected",
    risk_level: verdict === "unknown" ? null : "medium",
    vault_probed: false,
    checks: blockedBy.map((id) => ({ id, severity: "critical", requires_approval: false })),
    wrap: { exec_ready: blockedBy.length === 0, blocked_by: blockedBy },
  });
}
const runner =
  (status: number | null, stdout: string, missing = false): PreflightRunner =>
  () => ({ status, stdout, missing });

describe("preflightMode", () => {
  test("off by default and for unknown values", () => {
    expect(preflightMode({})).toBe("off");
    expect(preflightMode({ STACK_PHANTOM_PREFLIGHT: "0" })).toBe("off");
    expect(preflightMode({ STACK_PHANTOM_PREFLIGHT: "yes please" })).toBe("off");
  });
  test("on and strict", () => {
    expect(preflightMode({ STACK_PHANTOM_PREFLIGHT: "1" })).toBe("on");
    expect(preflightMode({ STACK_PHANTOM_PREFLIGHT: "true" })).toBe("on");
    expect(preflightMode({ STACK_PHANTOM_PREFLIGHT: "Strict" })).toBe("strict");
  });
});

describe("runAgentPreflight (contract exit codes 0-3)", () => {
  test("off never runs phantom", () => {
    let ran = false;
    const out = runAgentPreflight("off", () => {
      ran = true;
      return { status: 0, stdout: doc("ready"), missing: false };
    });
    expect(ran).toBe(false);
    expect(out).toEqual({ verdict: null, blockedBy: [], refuse: false, message: null });
  });

  test.each([
    ["on", 0, "ready", false],
    ["on", 2, "degraded", false],
    ["on", 1, "blocked", true],
    ["on", 3, "unknown", false],
    ["strict", 0, "ready", false],
    ["strict", 2, "degraded", true],
    ["strict", 1, "blocked", true],
    ["strict", 3, "unknown", true],
  ] as const)("%s mode, exit %d (%s): refuse=%s", (mode, status, verdict, refuse) => {
    const out = runAgentPreflight(
      mode,
      runner(status, doc(verdict, verdict === "blocked" ? ["unprotected-env-file"] : [])),
    );
    expect(out.verdict).toBe(verdict);
    expect(out.refuse).toBe(refuse);
    if (verdict === "ready") expect(out.message).toBeNull();
    else expect(out.message).toContain(verdict);
  });

  test("blocked names the critical check ids and nothing else", () => {
    const out = runAgentPreflight(
      "on",
      runner(1, doc("blocked", ["unprotected-env-file", "sk-live-NOT AN ID"])),
    );
    expect(out.blockedBy).toEqual(["unprotected-env-file"]);
    expect(out.message).toContain("unprotected-env-file");
    expect(out.message).not.toContain("sk-live");
  });

  test("phantom not installed: warns, never refuses, even in strict", () => {
    const out = runAgentPreflight("strict", runner(null, "", true));
    expect(out.refuse).toBe(false);
    expect(out.message).toContain("not installed");
  });

  test.each([
    ["an older phantom (usage error, no JSON)", 2, "error: unrecognized subcommand 'agent'"],
    ["a different kind", 0, JSON.stringify({ schema_version: 1, kind: "other", verdict: "ready" })],
    [
      "a newer schema",
      1,
      JSON.stringify({ schema_version: 2, kind: "phantom.agent.preflight", verdict: "blocked" }),
    ],
    ["an exit code outside 0-3", 101, doc("ready")],
  ])("%s degrades to a warning", (_name, status, stdout) => {
    const out = runAgentPreflight("strict", runner(status, stdout));
    expect(out.refuse).toBe(false);
    expect(out.verdict).toBeNull();
    expect(out.message).toContain("skipped");
    expect(out.message).not.toContain(stdout);
  });
});

describe("stack exec with STACK_PHANTOM_PREFLIGHT", () => {
  const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
  const created: string[] = [];
  afterEach(() => {
    while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
  });
  function tmp(p: string) {
    const d = mkdtempSync(join(tmpdir(), p));
    created.push(d);
    return d;
  }

  function run(env: Record<string, string>, json: string, exit: number) {
    const bin = tmp("stack-pf-bin-");
    writeFileSync(join(bin, "pf.json"), json);
    writeFileSync(
      join(bin, "phantom"),
      `#!/bin/sh
case "$1" in
  --version) echo "phantom fake 0.0.1" ;;
  agent) cat "${join(bin, "pf.json")}"; exit ${exit} ;;
  exec) shift; [ "$1" = "--" ] && shift; exec "$@" ;;
esac
`,
    );
    chmodSync(join(bin, "phantom"), 0o755);
    const cwd = tmp("stack-pf-proj-");
    writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n');
    const r = spawnSync("bun", [CLI_ENTRY, "exec", "--", "sh", "-c", "echo RAN"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
        STACK_NO_TELEMETRY: "1",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        ...env,
      },
    });
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  test.skipIf(process.platform === "win32")(
    "off by default: a blocked verdict is not consulted",
    () => {
      const r = run({ STACK_PHANTOM_PREFLIGHT: "" }, doc("blocked", ["unprotected-env-file"]), 1);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("RAN\n");
      expect(r.stderr).not.toContain("preflight");
    },
  );

  test.skipIf(process.platform === "win32")("on: blocked stops before the command runs", () => {
    const r = run({ STACK_PHANTOM_PREFLIGHT: "1" }, doc("blocked", ["unprotected-env-file"]), 1);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("blocked (unprotected-env-file)");
  });

  test.skipIf(process.platform === "win32")("on: degraded warns and runs", () => {
    const r = run({ STACK_PHANTOM_PREFLIGHT: "1" }, doc("degraded"), 2);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("RAN\n");
    expect(r.stderr).toContain("degraded, continuing");
  });
});
