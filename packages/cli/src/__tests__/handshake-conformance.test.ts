/**
 * Handshake conformance kit: the canonical v1 contract lives in
 * contract/ashlr-handshake.v1.json. Other repos vendor that file and pin its
 * sha256; this test pins the same hash so a contract edit cannot land without
 * a deliberate re-pin (and re-vendoring) everywhere.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIX_TOOLS } from "../lib/doctor-fix.ts";
import {
  type Contract,
  checkGatedRun,
  checkHandshake,
  gatedFor,
} from "../lib/handshake-conformance.ts";
import { buildHandshake } from "../lib/handshake.ts";

const root = join(import.meta.dir, "..", "..", "..", "..");
const contractPath = join(root, "contract", "ashlr-handshake.v1.json");
const raw = readFileSync(contractPath);
const contract = JSON.parse(raw.toString("utf8")) as Contract;
const PINNED_SHA256 = "1f6679138a048f6882eb33f84ab2894b54e51898f887a5cb9c19cc9731c5c171";

describe("handshake contract v1", () => {
  test("the contract file matches its pinned sha256 and the .sha256 file", () => {
    const sha = createHash("sha256").update(raw).digest("hex");
    expect(sha).toBe(PINNED_SHA256);
    const listed = readFileSync(`${contractPath}.sha256`, "utf8").split(/\s+/)[0];
    expect(listed).toBe(sha);
  });

  test("`stack --ashlr-handshake --json` conforms", () => {
    const entry = join(import.meta.dir, "..", "index.ts");
    const r = spawnSync(process.execPath, [entry, "--ashlr-handshake", "--json"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
        DO_NOT_TRACK: "1",
      },
    });
    expect(r.status).toBe(0);
    const h = JSON.parse(r.stdout.trim());
    expect(checkHandshake(h, contract)).toEqual([]);
    // Stack advertises no gated capability today; if it ever does, its argv must be checked here.
    expect(gatedFor(h, contract)).toEqual([]);
  });

  test("stack's own doctor --ecosystem --fix runs exactly the contract's doctor-fix argv", () => {
    const g = contract.gated_capabilities["doctor-fix"]!;
    for (const t of FIX_TOOLS) {
      expect(t.capability).toBe("doctor-fix");
      expect(t.previewArgv).toEqual(g.argv);
    }
  });

  test("the checker catches drift", () => {
    const good = buildHandshake("1.2.3", {
      which: () => "/bin/phantom",
      cwd: "/p",
      exists: () => false,
    });
    expect(checkHandshake(good, contract)).toEqual([]);
    const bad = (patch: Record<string, unknown>) =>
      checkHandshake({ ...structuredClone(good), ...patch }, contract);
    expect(bad({ kind: "other" })).not.toEqual([]);
    expect(bad({ schema_version: 2 })).not.toEqual([]);
    expect(bad({ version: "v1" })).not.toEqual([]);
    expect(bad({ capabilities: ["Doctor_Fix"] })).not.toEqual([]);
    expect(bad({ capabilities: ["a", "a"] })).not.toEqual([]);
    expect(bad({ edits: ["/etc/passwd"] })).not.toEqual([]);
    expect(bad({ protocols: { mcp: 1 } })).not.toEqual([]);
    expect(bad({ health: { status: "ok", checks: [{ id: "x", status: "missing" }] } })).not.toEqual(
      [],
    );
    expect(bad({ health: { status: "fine", checks: [] } })).not.toEqual([]);
    const { receipts: _r, ...noReceipts } = good;
    expect(checkHandshake(noReceipts, contract)).toEqual(["missing field receipts"]);
  });

  test("gated runs: exit code and stdout shape", () => {
    const g = contract.gated_capabilities["doctor-fix"]!;
    expect(checkGatedRun("doctor-fix", g, 0, '{"mode":"preview","plan":{}}')).toEqual([]);
    expect(checkGatedRun("doctor-fix", g, 2, "error: unknown option '--fix'")).toHaveLength(2);
    expect(checkGatedRun("doctor-fix", g, 0, '{"mode":"preview"}')).toEqual([
      "doctor-fix: output lacks plan",
    ]);
  });
});
