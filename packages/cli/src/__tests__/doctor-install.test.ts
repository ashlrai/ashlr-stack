import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installEnvelope } from "../lib/doctor-envelope.ts";
import type { FixRunner, RunResult } from "../lib/doctor-fix.ts";
import {
  InstallUsageError,
  LOCUS_CARGO_ARGV,
  formatInstallReport,
  installTable,
  locusInstall,
  parseNode,
  runDoctorInstall,
} from "../lib/doctor-install.ts";
import type { EcosystemEntry } from "../lib/ecosystem.ts";

const SECRET_ENV = {
  PATH: "/bin",
  HOME: "/h",
  GITHUB_TOKEN: "SECRET_VALUE",
  NPM_TOKEN: "SECRET_VALUE",
  LOCUS_CONTROL_CAPABILITY: "SECRET_VALUE",
  PHANTOM_TOKEN: "phm_SECRET_VALUE",
};

const missingAll: EcosystemEntry[] = ["phantom", "locus", "lexicon", "ashlr-md"].map((n) => ({
  name: n,
  command: n,
  status: "missing",
}));

function fake(node: string, codes: Record<string, number> = {}) {
  const calls: { argv: string[]; env: Record<string, string> }[] = [];
  const runner: FixRunner = async (command, argv, env) => {
    calls.push({ argv: [command, ...argv], env });
    if (command === "node") return { kind: "exited", code: 0, stdout: node };
    const code = codes[command] ?? 0;
    return { kind: "exited", code, stdout: "" } as RunResult;
  };
  return { runner, calls };
}

describe("doctor --install", () => {
  test("parseNode", () => {
    expect(parseNode("v22.15.0\n")).toEqual([22, 15]);
    expect(parseNode("nope")).toBeNull();
  });

  test("locus uses cargo while npm is broken, npm once a fixed version is set", () => {
    expect(locusInstall(null).argv).toEqual(LOCUS_CARGO_ARGV);
    expect(locusInstall("0.5.0").argv).toEqual(LOCUS_CARGO_ARGV);
    expect(locusInstall("0.5.2").argv).toEqual(["npm", "install", "-g", "locus-cli@0.5.2"]);
  });

  test("preview prints a safe order, runs only the node probe, never stack onboard", async () => {
    const f = fake("v22.15.1");
    const r = await runDoctorInstall([], undefined, {
      entries: missingAll,
      runner: f.runner,
      env: SECRET_ENV,
    });
    expect(r.mode).toBe("preview");
    expect(r.outcome).toBeNull();
    expect(r.plan.node).toBe("22.15");
    expect(r.plan.steps.map((s) => `${s.tool}:${s.reason}:${s.outcome}`)).toEqual([
      "phantom:missing:planned",
      "locus:missing:planned",
      "lexicon:missing:planned",
      "ashlr-md:missing:manual",
      "phantom:verify:planned",
    ]);
    expect(f.calls.map((c) => c.argv)).toEqual([["node", "--version"]]);
    const text = JSON.stringify(r) + formatInstallReport(r).join("\n");
    expect(text).not.toContain("onboard");
    expect(text).toContain("exit 1 is expected");
    expect(installEnvelope(r).status).toBe("warn");
  });

  test("old Node blocks the phantom step first; lexicon (Node 20+) still plans", async () => {
    const f = fake("v20.19.2");
    const r = await runDoctorInstall(["phantom", "lexicon"], undefined, {
      entries: missingAll,
      runner: f.runner,
    });
    expect(r.plan.steps[0]?.outcome).toBe("blocked");
    expect(r.plan.steps[0]?.detail).toContain("Node 22.15+");
    expect(r.plan.steps[1]?.outcome).toBe("planned");
    expect(installEnvelope(r).status).toBe("fail");
  });

  test("installed and current tools are not planned; locus 0.5.0 counts as outdated", async () => {
    const entries: EcosystemEntry[] = [
      { name: "phantom", command: "phm", status: "ok", contract: "ok", version: "3.29.15" },
      { name: "locus", command: "locus", status: "ok", contract: "ok", version: "0.5.0" },
      { name: "lexicon", command: "lexicon", status: "no-handshake" },
      { name: "ashlr-md", command: "mdopener-mcp", status: "ok", contract: "ok" },
    ];
    const r = await runDoctorInstall([], undefined, { entries, runner: fake("v22.15.0").runner });
    expect(r.plan.steps.map((s) => `${s.tool}:${s.reason}`)).toEqual([
      "locus:outdated",
      "lexicon:outdated",
      "phantom:verify",
    ]);
  });

  test("apply runs named tools only, fixed argv, base env without secrets", async () => {
    const f = fake("v22.15.0");
    const r = await runDoctorInstall([], ["lexicon"], {
      entries: missingAll,
      runner: f.runner,
      env: SECRET_ENV,
    });
    expect(r.outcome).toEqual({ stopped_at: null });
    expect(f.calls.map((c) => c.argv)).toEqual([
      ["node", "--version"],
      ["npm", "install", "-g", "@ashlr/lexicon"],
    ]);
    for (const c of f.calls) {
      expect(c.env).toEqual({ PATH: "/bin", HOME: "/h", NO_COLOR: "1" });
      expect(JSON.stringify(c.env)).not.toContain("SECRET");
    }
    expect(r.plan.steps.find((s) => s.tool === "lexicon")?.outcome).toBe("installed");
    expect(r.plan.steps.find((s) => s.tool === "locus")?.outcome).toBe("planned");
  });

  test("apply stops at the first non-zero exit; phm doctor exit 1 is expected", async () => {
    const f = fake("v22.15.0", { cargo: 101, phm: 1 });
    const r = await runDoctorInstall([], ["phantom", "locus", "lexicon"], {
      entries: missingAll,
      runner: f.runner,
    });
    expect(r.outcome).toEqual({ stopped_at: "locus" });
    expect(r.plan.steps.map((s) => s.outcome)).toEqual([
      "installed",
      "failed",
      "not_run",
      "manual",
      "not_run",
    ]);
    expect(f.calls.map((c) => c.argv[0])).toEqual(["node", "npm", "cargo"]);

    const g = fake("v22.15.0", { phm: 1 });
    const ok = await runDoctorInstall([], ["phantom"], { entries: missingAll, runner: g.runner });
    expect(ok.outcome).toEqual({ stopped_at: null });
    expect(ok.plan.steps.at(-1)?.outcome).toBe("checked");
    expect(installEnvelope(ok).status).toBe("warn"); // the manual ashlr-md step
  });

  test("blocked Node stops apply before anything runs", async () => {
    const f = fake("v20.19.2");
    const r = await runDoctorInstall([], ["phantom", "lexicon"], {
      entries: missingAll,
      runner: f.runner,
    });
    expect(r.outcome).toEqual({ stopped_at: "phantom" });
    expect(f.calls.map((c) => c.argv[0])).toEqual(["node"]);
  });

  test("usage errors run nothing", async () => {
    const f = fake("v22.15.0");
    const run = (only: string[], apply: string[] | undefined) =>
      runDoctorInstall(only, apply, { entries: missingAll, runner: f.runner });
    await expect(run([], [])).rejects.toBeInstanceOf(InstallUsageError);
    await expect(run(["nope"], undefined)).rejects.toThrow("'nope' is not a tool");
    await expect(run([], ["$(rm -rf /)"])).rejects.toThrow("<invalid name>");
    await expect(run(["lexicon"], ["locus"])).rejects.toThrow("outside --install");
    expect(f.calls).toEqual([]);
  });

  test("table: every command is a fixed argv with no shell metacharacters", () => {
    for (const t of installTable())
      for (const a of t.argv ?? []) expect(a).not.toMatch(/[;&|`$<>]/);
  });
});

describe("stack doctor --ecosystem --install (CLI)", () => {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const entry = join(dirname(import.meta.path), "..", "index.ts");
  const cli = (args: string[]) => {
    const empty = mkdtempSync(join(tmpdir(), "stack-install-"));
    try {
      return spawnSync(process.execPath, [entry, "doctor", ...args], {
        env: { PATH: empty, HOME: empty, NO_COLOR: "1" },
        encoding: "utf8",
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  };

  test("--json preview: ashlr.doctor v1 with {mode, plan, outcome}, exit 0", () => {
    const r = cli(["--ecosystem", "--install", "--json"]);
    expect(r.status).toBe(0);
    const v = JSON.parse(r.stdout);
    expect(v.kind).toBe("ashlr.doctor");
    expect(v.mode).toBe("preview");
    expect(v.outcome).toBeNull();
    expect(v.plan.node).toBe("not found");
    expect(v.plan.steps[0]).toMatchObject({ tool: "phantom", outcome: "blocked" });
  });

  test("--install with --fix is a usage error", () => {
    const r = cli(["--ecosystem", "--fix", "--install", "--json"]);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("--install works with --ecosystem");
  });
});
