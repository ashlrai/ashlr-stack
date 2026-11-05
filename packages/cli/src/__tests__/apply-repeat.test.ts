import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import {
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
import { writeShimmedExecutable } from "../../../core/src/__tests__/_harness.ts";

/**
 * Regression: running `stack apply` twice with a secret missing from Phantom
 * must report it both times and never write the `TODO_STACK_APPLY`
 * placeholder anywhere (stdout, stderr, the vault, or files in the project).
 */

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "TODO_STACK_APPLY";

setDefaultTimeout(30_000);

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-repeat-"));
  createdDirs.push(dir);
  return dir;
}

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("stack apply repeated runs", () => {
  it("preserves an unchanged plan and existing vault value on both runs", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const recipe = join(dir, ".stack", "recipes", "multiple.toml");
    const plan =
      'id = "multiple"\nquery = "database and ai"\ncreatedAt = "2026-10-17T00:00:00.000Z"\n\n[[providers]]\nname = "neon"\n\n[[providers]]\nname = "openai"\n';
    mkdirSync(dirname(recipe), { recursive: true });
    writeFileSync(join(dir, ".stack.toml"), "");
    writeFileSync(recipe, plan);

    const script = join(dir, "run-multiple.ts");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
import { copyFileSync } from "node:fs";
import { setupFakePhantom } from ${JSON.stringify(join(CLI_DIR, "../../core/src/__tests__/_harness.ts"))};
const h = setupFakePhantom({ NEON_API_KEY: "existing-test-value" });
try {
  mock.module(${JSON.stringify(join(CLI_DIR, "lib/provision-loop.ts"))}, () => ({
    provisionProviders: async () => ({ succeeded: ["neon", "openai"], failures: [] }),
  }));
  mock.module(${JSON.stringify(join(CLI_DIR, "lib/phantom-preflight.ts"))}, () => ({ requirePhantom: async () => {} }));
  mock.module(${JSON.stringify(join(CLI_DIR, "commands/doctor.ts"))}, () => ({ doctorCommand: { run: async () => {} } }));
  const { applyCommand } = await import(${JSON.stringify(join(CLI_DIR, "commands/apply.ts"))});
  for (let i = 1; i <= 2; i++) {
    console.log("--- run " + i);
    await applyCommand.run({ args: { recipeId: "multiple", noWire: false, noRollback: false } });
    copyFileSync(h.vaultPath, "vault-" + i + ".json");
    copyFileSync(${JSON.stringify(recipe)}, "recipe-" + i + ".toml");
  }
  copyFileSync(h.logPath, "phantom-calls.jsonl");
} finally { h.cleanup(); }
`,
    );
    const result = spawnSync("bun", [script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1", CI: "1" },
      timeout: 20_000,
    });
    expect(result.status).toBe(0);
    const runs = result.stdout.split("--- run ").slice(1);
    expect(runs).toHaveLength(2);
    for (const [index, run] of runs.entries()) {
      expect(run).toContain("secrets in vault 1");
      expect(run).toContain("missing 2");
      expect(run).toContain("DATABASE_URL, OPENAI_API_KEY");
      expect(readFileSync(join(dir, `recipe-${index + 1}.toml`), "utf8")).toBe(plan);
      expect(JSON.parse(readFileSync(join(dir, `vault-${index + 1}.json`), "utf8"))).toEqual({
        NEON_API_KEY: "existing-test-value",
      });
    }
    expect(result.stdout + result.stderr).not.toContain(MARKER);
    const calls = readFileSync(join(dir, "phantom-calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { cmd: string; args: string[] });
    expect(calls.filter((call) => call.cmd === "list")).toEqual([
      { cmd: "list", args: ["--json"] },
      { cmd: "list", args: ["--json"] },
    ]);
    expect(calls.filter((call) => ["add", "remove"].includes(call.cmd))).toEqual([]);
  });

  it("never writes TODO_STACK_APPLY across two runs with a missing value", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    const calls = join(home, "phantom-calls");
    mkdirSync(bin);
    // Fake vault: empty, and records every subcommand so writes are detectable.
    writeShimmedExecutable(
      bin,
      "phantom",
      `#!/bin/sh
echo "$@" >> '${calls}'
case "$1" in
 --version) echo fixture;;
 list) echo '[]';;
 *) exit 1;;
esac
`,
    );
    mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
    writeFileSync(join(dir, ".stack.toml"), "");
    writeFileSync(
      join(dir, ".stack", "recipes", "example.toml"),
      'id = "example"\nquery = "ai"\ncreatedAt = "2026-10-17T00:00:00.000Z"\n\n[[providers]]\nname = "openai"\n',
    );

    const script = join(dir, "run-apply.ts");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
mock.module(${JSON.stringify(join(CLI_DIR, "lib/provision-loop.ts"))}, () => ({
  provisionProviders: async () => ({ succeeded: ["openai"], failures: [] }),
}));
mock.module(${JSON.stringify(join(CLI_DIR, "lib/phantom-preflight.ts"))}, () => ({
  requirePhantom: async () => {},
}));
mock.module(${JSON.stringify(join(CLI_DIR, "commands/doctor.ts"))}, () => ({
  doctorCommand: { run: async () => {} },
}));
const { applyCommand } = await import(${JSON.stringify(join(CLI_DIR, "commands/apply.ts"))});
for (let i = 0; i < 2; i++) {
  console.log("--- run " + (i + 1));
  await applyCommand.run({ args: { recipeId: "example", noWire: false, noRollback: false } });
}
`,
    );
    const result = spawnSync("bun", [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
        CI: "1",
      },
      timeout: 20_000,
    });
    expect(result.status).toBe(0);

    // The missing key is reported on both runs, with no placeholder value.
    const runs = result.stdout.split("--- run ").slice(1);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run).toContain("OPENAI_API_KEY");
      expect(run).toContain("phantom add <NAME>");
    }
    expect(result.stdout + result.stderr).not.toContain(MARKER);

    // The vault was only read, never written.
    const phantomCalls = readFileSync(calls, "utf8").trim().split("\n");
    expect(phantomCalls.filter((call) => call === "list --json")).toHaveLength(2);
    expect(phantomCalls.every((call) => ["--version", "list --json"].includes(call))).toBe(true);
    expect(phantomCalls.join("\n")).not.toContain(MARKER);

    // Nothing on disk (project or HOME) contains the placeholder, except the
    // fixture files this test wrote itself.
    for (const root of [dir, home]) {
      for (const file of walk(root)) {
        if (file === script || file === join(bin, "phantom") || file === calls) continue;
        expect(readFileSync(file, "utf8")).not.toContain(MARKER);
      }
    }
  });
});
