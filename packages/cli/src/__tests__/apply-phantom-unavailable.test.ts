import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writePhantomShim } from "./_phantom-shim.ts";

/**
 * Regression: `stack apply` must surface a clear failure when Phantom Secrets
 * is unavailable, and it must fail at the vault preflight — before any
 * provider provisioning or secret wiring — so the former `TODO_STACK_APPLY`
 * placeholder can never be written. There is no vault to write to, and
 * `phantom add` must never be invoked.
 *
 * "Unavailable" is exercised two ways: a PATH with no phantom binary at all,
 * and a PATH whose phantom fails `--version`. Both must reach the same
 * install hint and exit 1 from `requirePhantom`.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const MARKER = "TODO_STACK_APPLY";
const INSTALL_HINT = "Phantom Secrets isn't installed";

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-nophantom-"));
  createdDirs.push(dir);
  return dir;
}

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1", ...env },
    timeout: 20_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? -1,
  };
}

/**
 * A child env whose PATH can never resolve `phantom`: `bin` is under our
 * control. HOME and the project registry are isolated.
 */
function phantomlessEnv(home: string, bin: string): Record<string, string> {
  return {
    HOME: home,
    USERPROFILE: home,
    PATH: bin,
    STACK_REGISTRY_DIR: join(home, "registry"),
  };
}

function seedRecipe(dir: string, id: string, providers: string[]): void {
  mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
  const entries = providers.map((name) => `[[providers]]\nname = "${name}"`).join("\n\n");
  writeFileSync(
    join(dir, ".stack", "recipes", `${id}.toml`),
    `id = "${id}"\nquery = "ai"\ncreatedAt = "2026-10-17T00:00:00.000Z"\n\n${entries}\n`,
  );
}

function expectNoMarkerInFiles(...roots: string[]): void {
  for (const root of roots) {
    for (const file of walk(root)) {
      expect(readFileSync(file, "utf8")).not.toContain(MARKER);
    }
  }
}

setDefaultTimeout(30_000);

describe("stack apply without Phantom", () => {
  it("exits with the install hint before provisioning when no phantom is on PATH", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    mkdirSync(bin); // stays empty: no phantom anywhere on the child's PATH
    writeFileSync(join(dir, ".stack.toml"), "");
    seedRecipe(dir, "example", ["openai"]);

    const { stdout, stderr, code } = runCli(["apply", "example"], dir, phantomlessEnv(home, bin));
    const out = stdout + stderr;

    // The failure is surfaced, not swallowed.
    expect(code).toBe(1);
    expect(out).toContain(INSTALL_HINT);
    expect(out).toContain("brew install ashlrai/phantom/phantom");
    expect(out).toContain("Then re-run this command.");

    // It happened at the preflight: no auto-init, no provisioning, no wiring,
    // no success outro — and no placeholder anywhere in the output.
    expect(out).not.toContain("auto-running");
    expect(out).not.toContain("stack add openai");
    expect(out).not.toContain("secrets in vault");
    expect(out).not.toContain("applied.");
    expect(out).not.toContain(MARKER);

    // Nothing was written: the seeded config is untouched, no registry entry
    // was created, and no file on disk carries the placeholder.
    expect(readFileSync(join(dir, ".stack.toml"), "utf8")).toBe("");
    expect(readdirSync(dir).sort()).toEqual([".stack", ".stack.toml"]);
    expect(existsSync(join(home, "registry", "projects.json"))).toBe(false);
    expectNoMarkerInFiles(dir, home);
  });

  it("still fails at the vault preflight after auto-init on a blank dir", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    mkdirSync(bin);
    seedRecipe(dir, "example", ["openai"]);
    // No .stack.toml — the golden path auto-inits first, and init tolerates a
    // missing Phantom with a warning before the apply preflight stops the run.

    const { stdout, stderr, code } = runCli(["apply", "example"], dir, phantomlessEnv(home, bin));
    const out = stdout + stderr;

    expect(code).toBe(1);
    expect(out).toContain("auto-running");
    expect(out).toContain(INSTALL_HINT);
    expect(out).not.toContain("stack add openai");
    expect(out).not.toContain("secrets in vault");
    expect(out).not.toContain("applied.");
    expect(out).not.toContain(MARKER);

    // init legitimately wrote the config files, but the recipe's provider was
    // never provisioned into them and no placeholder landed anywhere.
    const config = readFileSync(join(dir, ".stack.toml"), "utf8");
    expect(config).not.toContain("openai");
    expectNoMarkerInFiles(dir, home);
  });

  it("treats a phantom that fails --version as unavailable and only ever probes it", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    const calls = join(home, "phantom-calls");
    mkdirSync(bin);
    // Present but broken: resolves on PATH, fails every invocation.
    writePhantomShim(bin, `#!/bin/sh\necho "$@" >> '${calls}'\nexit 1\n`);
    writeFileSync(join(dir, ".stack.toml"), "");
    seedRecipe(dir, "example", ["openai"]);

    const { stdout, stderr, code } = runCli(["apply", "example"], dir, phantomlessEnv(home, bin));
    const out = stdout + stderr;

    expect(code).toBe(1);
    expect(out).toContain(INSTALL_HINT);
    expect(out).not.toContain("stack add openai");
    expect(out).not.toContain("secrets in vault");
    expect(out).not.toContain(MARKER);

    // The availability probe is the only call Phantom ever saw — no add, list
    // or reveal — so no placeholder value could have reached the vault.
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["--version"]);
    expect(readFileSync(join(dir, ".stack.toml"), "utf8")).toBe("");
    expectNoMarkerInFiles(dir, home);
  });
});
