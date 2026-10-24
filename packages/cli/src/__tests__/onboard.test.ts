import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stack-onboard-cli-"));
  mkdirSync(join(home, ".gemini"));
  mkdirSync(join(home, ".cursor"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(...args: string[]) {
  const emptyBin = join(home, "bin");
  mkdirSync(emptyBin, { recursive: true });
  return spawnSync(process.execPath, [CLI_ENTRY, "onboard", "--home", home, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: emptyBin, NO_COLOR: "1", CI: "1", STACK_TELEMETRY: "0" },
  });
}

describe("stack onboard", () => {
  test("default run is a plan and writes nothing", () => {
    const r = run("--json");
    expect(r.status).toBe(0);
    const plan = JSON.parse(r.stdout);
    expect(plan.mode).toBe("plan");
    expect(plan.clients.filter((c: { willWrite: boolean }) => c.willWrite)).toHaveLength(2);
    expect(existsSync(join(home, ".gemini", "settings.json"))).toBe(false);
  });

  test("--apply wires detected clients and --undo reverses it", () => {
    const a = run("--apply", "--json");
    expect(a.status).toBe(0);
    const applied = JSON.parse(a.stdout);
    expect(applied.written).toHaveLength(2);
    const settings = JSON.parse(readFileSync(join(home, ".gemini", "settings.json"), "utf8"));
    expect(settings.mcpServers["ashlr-hub"].command).toBe("ashlr");
    const u = run("--undo", "--json");
    expect(u.status).toBe(0);
    expect(existsSync(join(home, ".gemini", "settings.json"))).toBe(false);
  });

  test("rejects an unknown client with exit code 1, as JSON with --json", () => {
    const r = run("--client", "vim");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown client: vim");
    const j = run("--client", "vim", "--json");
    expect(j.status).toBe(1);
    expect(JSON.parse(j.stdout).error).toContain("Unknown client: vim");
  });

  test("--undo --json with nothing to undo is a JSON error", () => {
    const r = run("--undo", "--json");
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("nothing to undo");
  });
});
