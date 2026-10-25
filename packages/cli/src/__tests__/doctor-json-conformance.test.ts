/**
 * Conformance kit, doctor half: every `stack doctor --json` mode carries the
 * `ashlr.doctor` v1 wrapper (contract/ashlr-handshake.v1.json, `doctor`),
 * additively, with exit codes unchanged. Runs the real CLI in a temp HOME.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  errorEnvelope,
  fixEnvelope,
  reconcileEnvelope,
  reportsEnvelope,
} from "../lib/doctor-envelope.ts";
import { type Contract, checkDoctor } from "../lib/handshake-conformance.ts";

const root = join(import.meta.dir, "..", "..", "..", "..");
const contract = JSON.parse(
  readFileSync(join(root, "contract", "ashlr-handshake.v1.json"), "utf8"),
) as Contract;
const entry = join(import.meta.dir, "..", "index.ts");

function stack(args: string[], cwd: string, home: string) {
  // Only PATH and HOME (an empty PATH dir first so no companion is found).
  const empty = mkdtempSync(join(tmpdir(), "stack-doctor-bin-"));
  return spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: `${empty}:${process.env.PATH}`,
      HOME: home,
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
    },
  });
}

describe("stack doctor --json: ashlr.doctor v1", () => {
  test("no .stack.toml: error kept, wrapper added, status fail, exit 1 as before", () => {
    const home = mkdtempSync(join(tmpdir(), "stack-doctor-home-"));
    const r = stack(["doctor", "--json"], home, home);
    expect(r.status).toBe(1);
    const d = JSON.parse(r.stdout.trim());
    expect(checkDoctor(d, contract)).toEqual([]);
    expect(d).toMatchObject({
      kind: "ashlr.doctor",
      tool: "ashlr-stack",
      status: "fail",
      native_status: "error",
    });
    expect(typeof d.error).toBe("string");
  });

  test("--ecosystem: informational, exit 0, ecosystem and next_steps kept", () => {
    const home = mkdtempSync(join(tmpdir(), "stack-doctor-home-"));
    const r = stack(["doctor", "--ecosystem", "--json"], home, home);
    expect(r.status).toBe(0);
    const d = JSON.parse(r.stdout.trim());
    expect(checkDoctor(d, contract)).toEqual([]);
    expect(Array.isArray(d.ecosystem)).toBe(true);
    expect(Array.isArray(d.next_steps)).toBe(true);
    expect(d.native_status).toBe("informational");
    expect(d.checks).toHaveLength(d.ecosystem.length);
  });

  test("--reconcile: fields kept, exit 0 as before", () => {
    const home = mkdtempSync(join(tmpdir(), "stack-doctor-home-"));
    writeFileSync(join(home, "package.json"), "{}");
    const r = stack(["doctor", "--reconcile", "--json"], home, home);
    expect(r.status).toBe(0);
    const d = JSON.parse(r.stdout.trim());
    expect(checkDoctor(d, contract)).toEqual([]);
    expect(d).toHaveProperty("orphans");
    expect(d).toHaveProperty("untracked");
  });

  test("mapping: error -> fail, warn and unchecked -> warn, refused preflight -> fail", () => {
    const rep = (status: string) => ({
      reports: [{ project: "cwd", path: "/p", services: [{ name: "Neon DB", status }] }],
    });
    expect(reportsEnvelope(rep("ok"), false).status).toBe("ok");
    expect(reportsEnvelope(rep("warn"), false).status).toBe("warn");
    expect(reportsEnvelope(rep("unchecked"), false).status).toBe("warn");
    expect(reportsEnvelope(rep("error"), false)).toMatchObject({
      status: "fail",
      native_status: "failed",
    });
    expect(reportsEnvelope(rep("ok"), true).status).toBe("fail");
    expect(reportsEnvelope({ reports: [] }, false).status).toBe("warn");
    expect(reportsEnvelope(rep("ok"), false).checks[0]!.id).toBe("cwd-neon-db");
    for (const s of ["ok", "warn", "unchecked", "error"])
      expect(checkDoctor(reportsEnvelope(rep(s), false), contract)).toEqual([]);
    expect(errorEnvelope("x").status).toBe("fail");
    const fix = fixEnvelope({
      mode: "apply",
      stopped_at: "lexicon",
      tools: [{ tool: "lexicon", outcome: "refused" }],
    });
    expect(fix.status).toBe("fail");
    expect(checkDoctor(fix, contract)).toEqual([]);
    expect(reconcileEnvelope({ orphans: ["neon"], untracked: [] }).status).toBe("warn");
  });

  test("the checker catches a bad wrapper", () => {
    const good = errorEnvelope("x");
    expect(checkDoctor({ ...good, status: "error" }, contract)).not.toEqual([]);
    expect(checkDoctor({ ...good, kind: "x" }, contract)).not.toEqual([]);
    expect(checkDoctor({ ...good, checks: [{ status: "fail" }] }, contract)).not.toEqual([]);
    expect(checkDoctor({ ...good, status: "ok" }, contract)).toEqual([
      "a check is fail but status is not fail",
    ]);
    const { native_status: _n, ...noNative } = good;
    expect(checkDoctor(noNative, contract)).toEqual(["missing field native_status"]);
  });
});
