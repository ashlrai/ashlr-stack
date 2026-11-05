import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  it("never writes TODO_STACK_APPLY across two runs with a missing value", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    const calls = join(home, "phantom-calls");
    mkdirSync(bin);
    // Fake vault: empty, and records every subcommand so writes are detectable.
    // Written as `phantom.sh` + a `phantom` symlink like core's _harness.ts:
    // macOS Gatekeeper's provenance policy refuses to exec an extensionless
    // file written by a non-platform process.
    const stub = `#!/bin/sh
echo "$@" >> '${calls}'
case "$1" in
 --version) echo fixture;;
 list) echo '[]';;
 *) exit 1;;
esac
`;
    writeFileSync(join(bin, "phantom.sh"), stub);
    chmodSync(join(bin, "phantom.sh"), 0o755);
    try {
      symlinkSync(join(bin, "phantom.sh"), join(bin, "phantom"));
    } catch {
      writeFileSync(join(bin, "phantom"), stub);
      chmodSync(join(bin, "phantom"), 0o755);
    }
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
    expect(phantomCalls.every((call) => ["--version", "list --json"].includes(call))).toBe(true);
    expect(phantomCalls.join("\n")).not.toContain(MARKER);

    // Nothing on disk (project or HOME) contains the placeholder, except the
    // fixture files this test wrote itself.
    for (const root of [dir, home]) {
      for (const file of walk(root)) {
        if (
          file === script ||
          file === join(bin, "phantom") ||
          file === join(bin, "phantom.sh") ||
          file === calls
        )
          continue;
        expect(readFileSync(file, "utf8")).not.toContain(MARKER);
      }
    }
  });
});
