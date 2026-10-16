import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Harness, setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";

/**
 * `stack doctor` against Phantom Secrets 0.7.9 semantics: `reveal` refuses
 * without an attached terminal, so a healthcheck can never read a stored
 * token. A stored token must read as `unchecked` (stored, not verified), and
 * only a token absent from `phantom list --json` may read as missing.
 *
 * The fake phantom (see `_harness.ts`) mirrors the real 0.7.9 refusal; the
 * real binary is covered by `phantom-contract.test.ts`.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

let h: Harness;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stack-doctor-vault-"));
});

afterEach(() => {
  h?.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function writeProject(services: Record<string, string[]>): void {
  const entries = Object.entries(services)
    .map(
      ([name, secrets]) =>
        `[services.${name}]\nprovider = "${name}"\nresource_id = "prj_test"\nsecrets = ${JSON.stringify(secrets)}\n`,
    )
    .join("\n");
  writeFileSync(
    join(dir, ".stack.toml"),
    `[stack]\nversion = "1"\n\n${entries}\n[[environments]]\nname = "dev"\ndefault = true\n`,
  );
  writeFileSync(join(dir, ".stack.local.toml"), `[stack]\nproject_id = "stk_test01"\n`);
}

function doctorJson(): {
  code: number;
  services: Array<{ name: string; status: string; detail?: string }>;
} {
  const result = spawnSync("bun", [CLI_ENTRY, "doctor", "--json"], {
    encoding: "utf8",
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1", CI: "1" },
  });
  const parsed = JSON.parse(result.stdout) as {
    reports: Array<{ services: Array<{ name: string; status: string; detail?: string }> }>;
  };
  return { code: result.status ?? 0, services: parsed.reports[0]?.services ?? [] };
}

describe("stack doctor with Phantom Secrets 0.7.9", () => {
  it("reports a stored but unrevealable token as unchecked and passes", () => {
    h = setupFakePhantom({ VERCEL_TOKEN: "vercel-token-value", OPENAI_API_KEY: "sk-test" });
    writeProject({ vercel: ["VERCEL_TOKEN"], openai: ["OPENAI_API_KEY"] });

    const { code, services } = doctorJson();

    expect(services.map((s) => s.status)).toEqual(["unchecked", "unchecked"]);
    expect(services[0]?.detail).toContain("VERCEL_TOKEN stored in Phantom");
    expect(services[1]?.detail).toContain("OPENAI_API_KEY stored in Phantom");
    expect(services.some((s) => /missing from vault/.test(s.detail ?? ""))).toBe(false);
    expect(code).toBe(0);
    // Never tried to read a value any way other than the refused reveal.
    expect(
      h
        .callsTo("reveal")
        .map((c) => c.args[0])
        .sort(),
    ).toEqual(["OPENAI_API_KEY", "VERCEL_TOKEN"]);
  });

  it("still reports a token absent from the vault as missing and fails", () => {
    h = setupFakePhantom({ OPENAI_API_KEY: "sk-test" });
    writeProject({ vercel: ["VERCEL_TOKEN"], openai: ["OPENAI_API_KEY"] });

    const { code, services } = doctorJson();

    expect(services[0]).toMatchObject({
      name: "vercel",
      status: "error",
      detail: "VERCEL_TOKEN missing from vault",
    });
    expect(services[1]?.status).toBe("unchecked");
    expect(code).toBe(1);
  });
});

describe("stack doctor without a .stack.toml", () => {
  function doctor(args: string[]): { code: number; stdout: string; stderr: string } {
    const result = spawnSync("bun", [CLI_ENTRY, "doctor", ...args], {
      encoding: "utf8",
      cwd: dir,
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
    });
    return { code: result.status ?? 0, stdout: result.stdout, stderr: result.stderr };
  }

  it("fails with the `stack init` hint instead of reporting healthy", () => {
    h = setupFakePhantom();
    const { code, stdout, stderr } = doctor([]);
    const out = stdout + stderr;
    expect(out).toContain("No .stack.toml");
    expect(out).toContain("Run `stack init` first.");
    expect(out).not.toContain("All services healthy");
    expect(code).toBe(1);
  });

  it("--json emits an error object and exits 1", () => {
    h = setupFakePhantom();
    const { code, stdout } = doctor(["--json"]);
    const parsed = JSON.parse(stdout) as { error?: string; reports?: unknown };
    expect(parsed.error).toContain("No .stack.toml");
    expect(parsed.error).toContain("Run `stack init` first.");
    expect(parsed.reports).toBeUndefined();
    expect(code).toBe(1);
  });
});
