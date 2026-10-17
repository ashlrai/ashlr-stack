import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Harness, setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";

/**
 * What `stack doctor` prints to a pipe (an agent shell, CI, MCP).
 *
 * The failing run ends in `outroError`, which exits the process. Bun 1.2
 * dropped stdout still queued at exit, so a long report lost its tail and
 * its final error line. The run here prints one line per service, then that
 * error; every line must reach the reader on every Bun version.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

let h: Harness;
let dir: string;

beforeEach(() => {
  h = setupFakePhantom({}, { initialized: true });
  dir = mkdtempSync(join(tmpdir(), "stack-doctor-output-"));
});

afterEach(() => {
  h.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function writeProject(names: string[]): void {
  const services = names
    .map((name) => `[services.${name}]\nprovider = "${name}"\nsecrets = []\n`)
    .join("\n");
  writeFileSync(join(dir, ".stack.toml"), `[stack]\nversion = "1"\n\n${services}`);
  writeFileSync(join(dir, ".stack.local.toml"), `[stack]\nproject_id = "stk_test01"\n`);
}

function doctor(): { code: number | null; stdout: string } {
  const result = spawnSync("bun", [CLI_ENTRY, "doctor"], {
    encoding: "utf8",
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1", CI: "1", STACK_NO_UPDATE_CHECK: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout ?? "" };
}

describe("stack doctor output on a pipe", () => {
  it("delivers every line, including the final error, before exiting 1", () => {
    // Unregistered providers fail the check without any network access.
    const names = Array.from({ length: 40 }, (_, i) => `unregistered${i}`);
    writeProject(names);
    const { code, stdout } = doctor();
    expect(code).toBe(1);
    for (const name of names) expect(stdout).toContain(`${name}: No provider registered`);
    expect(stdout).toContain("One or more services failed.");
  });

  it("with no services, says there is nothing to check instead of 'healthy'", () => {
    writeProject([]);
    const { code, stdout } = doctor();
    expect(code).toBe(0);
    expect(stdout).not.toContain("All services healthy");
    expect(stdout).toContain("No services to check");
    expect(stdout).toContain("stack add <provider>");
  });
});
