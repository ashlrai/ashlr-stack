import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { buildHandshake } from "../lib/handshake.ts";

const deps = (phantom: boolean, stackToml: boolean) => ({
  which: (n: string) => (n === "phantom" && phantom ? "/usr/local/bin/phantom" : null),
  cwd: "/proj",
  exists: (p: string) => stackToml && p === join("/proj", ".stack.toml"),
});

describe("ashlr handshake v1", () => {
  test("identifies the contract and the CLI", () => {
    const h = buildHandshake("9.9.9", deps(true, true));
    expect(h.kind).toBe("ashlr.handshake");
    expect(h.schema_version).toBe(1);
    expect(h).toMatchObject({ name: "ashlr-stack", command: "stack", version: "9.9.9" });
    expect(h.protocols["phantom.agent.preflight"]).toBe(1);
    expect(h.health).toEqual({
      status: "ok",
      checks: [
        { id: "phantom-on-path", status: "ok" },
        { id: "stack-config", status: "ok" },
      ],
    });
  });

  test("a missing phantom degrades health; no .stack.toml is informational", () => {
    expect(buildHandshake("1", deps(false, true)).health.status).toBe("degraded");
    const h = buildHandshake("1", deps(true, false));
    expect(h.health.status).toBe("ok");
    expect(h.health.checks[1]).toEqual({ id: "stack-config", status: "absent" });
  });

  test("ids are kebab-case and edits name only config paths", () => {
    const h = buildHandshake("1", deps(true, true));
    for (const id of [...h.capabilities, ...h.health.checks.map((c) => c.id)]) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(h.edits).toContain("~/.claude.json");
    expect(h.edits.every((p) => !p.startsWith("/"))).toBe(true);
  });

  test("`stack --ashlr-handshake` prints exactly one JSON object", () => {
    const entry = join(import.meta.dir, "..", "index.ts");
    const r = spawnSync(process.execPath, [entry, "--ashlr-handshake"], {
      encoding: "utf8",
      env: { ...process.env, STACK_NO_UPDATE_CHECK: "1", STACK_TELEMETRY: "0", DO_NOT_TRACK: "1" },
    });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const h = JSON.parse(lines[0]);
    expect(h.kind).toBe("ashlr.handshake");
    expect(h.command).toBe("stack");
  });
});
