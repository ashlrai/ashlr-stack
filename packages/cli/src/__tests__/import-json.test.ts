import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function stack(args: string[], cwd = dir): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1", STACK_NO_UPDATE_CHECK: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
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

  it("reports malformed JSON input without creating a stack file or storing secrets", () => {
    writeFileSync(join(dir, "broken.json"), `{"RESEND_API_KEY": "${NEW_VALUE}"`);

    const { code, stdout, stderr } = stack(["import", "--json", "--from", "broken.json"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      error: "Invalid .env input on line 1: expected a valid KEY=VALUE assignment.",
    });
    expect(stdout + stderr).not.toContain(NEW_VALUE);
    expect(existsSync(join(dir, ".stack.toml"))).toBe(false);
    expect(vault()).toEqual({ OPENAI_API_KEY: STORED_VALUE });
    expect(h.callsTo("add")).toEqual([]);
  });

  it("reports malformed JSON input without a human-readable success message", () => {
    writeFileSync(join(dir, "broken.json"), `{"RESEND_API_KEY": "${NEW_VALUE}"`);

    const { code, stdout, stderr } = stack(["import", "--from", "broken.json"]);
    const output = stdout + stderr;
    expect(code).toBe(1);
    expect(output).toContain("Invalid .env input on line 1: expected a valid KEY=VALUE assignment");
    expect(output).not.toContain("Imported");
    expect(output).not.toContain(NEW_VALUE);
    expect(existsSync(join(dir, ".stack.toml"))).toBe(false);
    expect(vault()).toEqual({ OPENAI_API_KEY: STORED_VALUE });
    expect(h.callsTo("add")).toEqual([]);
  });
});

describe("stack import malformed input", () => {
  const cases = [
    { line: "BROKEN", reason: "expected a valid KEY=VALUE assignment" },
    { line: "INVALID-KEY=value", reason: "expected a valid KEY=VALUE assignment" },
    { line: `BROKEN="${NEW_VALUE}`, reason: "unterminated quoted value" },
    { line: "RESEND_API_KEY=another-value", reason: "duplicate key RESEND_API_KEY" },
  ];

  for (const { line, reason } of cases) {
    for (const flags of [[], ["--json"], ["--json", "--dryRun"]]) {
      it(`rejects ${reason} with ${flags.join(" ") || "human output"} before writing`, () => {
        writeFileSync(join(dir, ".env"), `# comment\nRESEND_API_KEY=${NEW_VALUE}\n${line}\n`);
        const configPath = join(dir, ".stack.toml");
        const originalConfig = '[services.existing]\nprovider = "existing"\n';
        if (flags.includes("--json")) writeFileSync(configPath, originalConfig);

        const { code, stdout, stderr } = stack(["import", ...flags]);
        expect(code).toBe(1);
        const message = flags.includes("--json") ? JSON.parse(stdout).error : stdout + stderr;
        expect(message).toContain(`line 3: ${reason}`);
        expect(stdout + stderr).not.toContain(NEW_VALUE);
        expect(vault()).toEqual({ OPENAI_API_KEY: STORED_VALUE });
        expect(h.callsTo("add")).toEqual([]);
        if (flags.includes("--json")) {
          expect(readFileSync(configPath, "utf8")).toBe(originalConfig);
        } else {
          expect(existsSync(configPath)).toBe(false);
        }
      });
    }
  }
});
