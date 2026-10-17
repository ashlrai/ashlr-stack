import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Harness, setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";

/**
 * `stack info <service> --json` and `stack env show --json`: one JSON object
 * on stdout, secret names only, never a value. Agents parse these.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const STORED_VALUE = "sk-test-not-a-real-key";

let h: Harness;
let dir: string;

beforeEach(() => {
  h = setupFakePhantom(
    { OPENAI_API_KEY: STORED_VALUE, LEFTOVER_TOKEN: "x" },
    { initialized: true },
  );
  dir = mkdtempSync(join(tmpdir(), "stack-info-json-"));
  writeFileSync(
    join(dir, ".stack.toml"),
    `[stack]\nversion = "1"\n\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n\n[services.resend]\nprovider = "resend"\nsecrets = ["RESEND_API_KEY"]\n`,
  );
  writeFileSync(
    join(dir, ".stack.local.toml"),
    `[stack]\nproject_id = "stk_test01"\n\n[services.openai]\nresource_id = "org_1"\ncreated_at = "2026-10-01T00:00:00.000Z"\n`,
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

describe("stack info --json", () => {
  it("prints the service as ashlr.stack.info/v1 with vault presence by name", () => {
    const { code, stdout } = stack(["info", "openai", "--json"]);
    expect(code).toBe(0);
    expect(stdout).not.toContain(STORED_VALUE);
    const report = JSON.parse(stdout);
    expect(report.schema).toBe("ashlr.stack.info/v1");
    expect(report.service).toBe("openai");
    expect(report.provider).toBe("openai");
    expect(report.auth_kind).toBe("api_key");
    expect(report.resource_id).toBe("org_1");
    expect(report.secrets).toEqual([{ name: "OPENAI_API_KEY", in_vault: true }]);
    expect(report.health === null || typeof report.health.kind === "string").toBe(true);
  });

  it("an unknown service or a missing project is a JSON error with exit 1", () => {
    const missing = stack(["info", "nope", "--json"]);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).error).toContain("nope is not in this stack");

    const empty = mkdtempSync(join(tmpdir(), "stack-info-json-empty-"));
    try {
      const noConfig = stack(["info", "openai", "--json"], empty);
      expect(noConfig.code).toBe(1);
      expect(JSON.parse(noConfig.stdout).error).toContain(".stack.toml");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("stack env show --json", () => {
  it("prints declared secret names with vault presence, missing and orphans", () => {
    for (const args of [
      ["env", "show", "--json"],
      ["env", "--json"],
    ]) {
      const { code, stdout } = stack(args);
      expect(code).toBe(0);
      expect(stdout).not.toContain(STORED_VALUE);
      const report = JSON.parse(stdout);
      expect(report.schema).toBe("ashlr.stack.env/v1");
      expect(report.env).toBe("dev");
      expect(report.services).toEqual([
        { name: "openai", secrets: [{ name: "OPENAI_API_KEY", in_vault: true }] },
        { name: "resend", secrets: [{ name: "RESEND_API_KEY", in_vault: false }] },
      ]);
      expect(report.missing).toEqual(["RESEND_API_KEY"]);
      expect(report.orphans).toEqual(["LEFTOVER_TOKEN"]);
      expect(report.totals).toEqual({ declared: 2, in_vault: 2 });
    }
  });
});
