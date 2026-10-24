import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Harness, setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";

/**
 * `stack import --json`: one JSON object naming what was stored, skipped and
 * wired. Names only, never a value.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const NEW_VALUE = "sk-test-new-not-real";
const STORED_VALUE = "sk-test-stored-not-real";

let h: Harness;
let dir: string;

beforeEach(() => {
  h = setupFakePhantom({ OPENAI_API_KEY: STORED_VALUE }, { initialized: true });
  dir = mkdtempSync(join(tmpdir(), "stack-import-json-"));
  writeFileSync(
    join(dir, ".env"),
    `OPENAI_API_KEY=${STORED_VALUE}\nRESEND_API_KEY=${NEW_VALUE}\nEMPTY_ONE=\nMY_APP_FLAG=${NEW_VALUE}x\n`,
  );
});

afterEach(() => {
  h.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function stack(args: string[], cwd = dir): { code: number | null; stdout: string } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1", STACK_NO_UPDATE_CHECK: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout ?? "" };
}

function vault(): Record<string, string> {
  return JSON.parse(readFileSync(h.vaultPath, "utf8"));
}

describe("stack import --json", () => {
  it("names what was stored, skipped and wired", () => {
    const { code, stdout } = stack(["import", "--json"]);
    expect(code).toBe(0);
    expect(stdout).not.toContain(NEW_VALUE);
    expect(stdout).not.toContain(STORED_VALUE);
    const report = JSON.parse(stdout);
    expect(report.schema).toBe("ashlr.stack.import/v1");
    expect(report.dry_run).toBe(false);
    expect(report.providers).toEqual({ openai: ["OPENAI_API_KEY"], resend: ["RESEND_API_KEY"] });
    expect(report.unattributed).toEqual(["EMPTY_ONE", "MY_APP_FLAG"]);
    expect(report.stored).toEqual(["RESEND_API_KEY", "MY_APP_FLAG"]);
    expect(report.skipped_existing).toEqual(["OPENAI_API_KEY"]);
    expect(report.skipped_empty).toEqual(["EMPTY_ONE"]);
    expect(report.services_added.sort()).toEqual(["openai", "resend"]);
    expect(report.services_kept).toEqual([]);
    expect(vault().RESEND_API_KEY).toBe(NEW_VALUE);
    expect(vault().OPENAI_API_KEY).toBe(STORED_VALUE);
  });

  it("--dryRun writes nothing and stores nothing", () => {
    const { code, stdout } = stack(["import", "--json", "--dryRun"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.dry_run).toBe(true);
    expect(report.stored).toEqual([]);
    expect(report.providers.resend).toEqual(["RESEND_API_KEY"]);
    expect(vault()).toEqual({ OPENAI_API_KEY: STORED_VALUE });
  });

  it("a missing file is a JSON error", () => {
    const { code, stdout } = stack(["import", "--json", "--from", "nope.env"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).error).toContain("nope.env not found");
  });
});
