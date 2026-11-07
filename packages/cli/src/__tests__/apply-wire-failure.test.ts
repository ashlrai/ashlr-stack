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
 * Regression: `stack apply` with a failing stubbed wiring command. When the
 * `phantom` subprocess behind wiring fails — the vault read (`phantom list
 * --json`) returning non-zero, or the wiring step itself throwing — the CLI
 * must surface the failure to the user and must never fall back to writing
 * the historical `TODO_STACK_APPLY` placeholder into the vault, the project,
 * or its output.
 */

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "TODO_STACK_APPLY";

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-wire-fail-"));
  createdDirs.push(dir);
  return dir;
}

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// The placeholder must not land anywhere on disk — the only files allowed to
// carry the string are the fixtures the test wrote itself.
function expectNoMarkerOnDisk(roots: string[], skip: string[]): void {
  for (const root of roots) {
    for (const file of walk(root)) {
      if (skip.includes(file)) continue;
      expect(readFileSync(file, "utf8")).not.toContain(MARKER);
    }
  }
}

// Each test spawns a full `bun` process running the real apply command; on
// loaded machines a single spawn can take several seconds.
setDefaultTimeout(30_000);

function writeStubPhantom(bin: string, calls: string, body: string): void {
  mkdirSync(bin);
  const script = `#!/bin/sh\necho "$@" >> '${calls}'\n${body}`;
  writePhantomShim(bin, script);
}

function seedRecipe(dir: string, id: string, providers: string[]): void {
  mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
  writeFileSync(join(dir, ".stack.toml"), "");
  const entries = providers.map((name) => `\n[[providers]]\nname = "${name}"\n`).join("");
  writeFileSync(
    join(dir, ".stack", "recipes", `${id}.toml`),
    `id = "${id}"\nquery = "ai and payments"\ncreatedAt = "2026-11-05T00:00:00.000Z"\n${entries}`,
  );
}

function runApplyScript(
  dir: string,
  home: string,
  bin: string,
  recipeId: string,
  succeeded: string[],
) {
  const script = join(dir, "run-apply.ts");
  writeFileSync(
    script,
    `import { mock } from "bun:test";
mock.module(${JSON.stringify(join(CLI_DIR, "lib/provision-loop.ts"))}, () => ({
  provisionProviders: async () => ({ succeeded: ${JSON.stringify(succeeded)}, failures: [] }),
}));
mock.module(${JSON.stringify(join(CLI_DIR, "commands/doctor.ts"))}, () => ({
  doctorCommand: { run: async () => {} },
}));
const { applyCommand } = await import(${JSON.stringify(join(CLI_DIR, "commands/apply.ts"))});
await applyCommand.run({ args: { recipeId: ${JSON.stringify(recipeId)}, noWire: false, noRollback: false } });
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
  return { script, result };
}

describe("stack apply — failing stubbed wiring command", () => {
  it("reports the unreadable vault as skipped and writes no placeholder when `phantom list` fails", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    const calls = join(home, "phantom-calls");
    // Stubbed wiring command: `--version` answers so the real preflight and
    // install check pass, but `phantom list --json` — the vault read wiring
    // depends on — fails. Every other invocation (above all `add`) fails too.
    writeStubPhantom(
      bin,
      calls,
      `case "$1" in
 --version) echo "phantom stub 0.0.1";;
 list) echo "stub: vault unreadable" >&2; exit 1;;
 *) exit 1;;
esac
`,
    );
    seedRecipe(dir, "vault-down", ["openai", "stripe"]);

    const { script, result } = runApplyScript(dir, home, bin, "vault-down", ["openai", "stripe"]);
    const out = result.stdout + result.stderr;

    // Wiring failure is non-fatal to apply, but it is reported: with the
    // vault unreadable, providers surface as skipped rather than missing.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("secrets in vault 0");
    expect(result.stdout).toContain("missing 0");
    expect(result.stdout).toContain("skipped 2");
    expect(result.stdout).toContain("phantom-wire skipped: openai, stripe");
    expect(result.stdout).toContain("vault-down applied.");
    // No missing names can be identified, so the "not in Phantom" hint and
    // the throw path must not appear.
    expect(out).not.toContain("not in Phantom");
    expect(out).not.toContain("phantom-wire failed");

    // Webhook stubs are plain files: they still materialize for
    // webhook-capable providers even when the vault read failed.
    expect(existsSync(join(dir, ".stack", "webhooks", "stripe.ts"))).toBe(true);
    expect(existsSync(join(dir, ".stack", "webhooks", "openai.ts"))).toBe(false);

    // The placeholder value appears nowhere: not in output, not in the
    // recorded phantom argv (no `add` call at all), not on disk.
    expect(out).not.toContain(MARKER);
    const phantomCalls = readFileSync(calls, "utf8").trim().split("\n");
    expect(phantomCalls).toEqual(["--version", "list --json"]);
    expectNoMarkerOnDisk(
      [dir, home],
      [script, join(bin, "phantom"), join(bin, "phantom.sh"), calls],
    );
  });

  it("reports `phantom-wire failed` when the wiring step throws and still writes no placeholder", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const bin = join(home, "bin");
    const calls = join(home, "phantom-calls");
    // Vault read works (empty vault); the failure is forced inside the
    // wiring step: `.stack/webhooks` exists as a regular file, so writing
    // the stripe stub throws and apply's catch must report it.
    writeStubPhantom(
      bin,
      calls,
      `case "$1" in
 --version) echo "phantom stub 0.0.1";;
 list) echo '[]';;
 *) exit 1;;
esac
`,
    );
    seedRecipe(dir, "throwing-wire", ["stripe"]);
    writeFileSync(join(dir, ".stack", "webhooks"), "not a directory");

    const { script, result } = runApplyScript(dir, home, bin, "throwing-wire", ["stripe"]);
    const out = result.stdout + result.stderr;

    expect(result.status).toBe(0);
    expect(out).toContain("phantom-wire failed:");
    // The throw discards the whole WireResult, so neither the vault summary
    // nor the missing-names hint is printed.
    expect(out).not.toContain("secrets in vault");
    expect(out).not.toContain("not in Phantom");
    expect(result.stdout).toContain("throwing-wire applied.");

    expect(out).not.toContain(MARKER);
    const phantomCalls = readFileSync(calls, "utf8").trim().split("\n");
    expect(phantomCalls).toEqual(["--version", "list --json"]);
    expectNoMarkerOnDisk(
      [dir, home],
      [script, join(bin, "phantom"), join(bin, "phantom.sh"), calls],
    );
  });
});
