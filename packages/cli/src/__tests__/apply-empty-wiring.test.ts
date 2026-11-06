import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression: `stack apply` on a recipe with no providers — an empty wiring
 * plan, nothing to provision, no secrets to check, no webhook stubs — must
 * not shell out to Phantom at all. The unconditional `requirePhantom`
 * preflight used to run `phantom --version` even for a no-op apply, so a
 * recipe that wires nothing still demanded a vault.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-empty-"));
  createdDirs.push(dir);
  return dir;
}

// The test spawns a full `bun` process that loads the real apply command;
// on loaded machines a single spawn can take several seconds.
setDefaultTimeout(30_000);

describe("stack apply — empty wiring plan", () => {
  it("does not invoke Phantom when the recipe wires nothing", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const cliDir = dirname(CLI_ENTRY);

    // An existing .stack.toml keeps auto-init out of the way; the recipe
    // declares no providers, so its wiring plan is empty.
    writeFileSync(join(dir, ".stack.toml"), "");
    mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
    writeFileSync(
      join(dir, ".stack", "recipes", "empty.toml"),
      'id = "empty"\nquery = "nothing to provision"\ncreatedAt = "2026-11-05T00:00:00.000Z"\nproviders = []\n',
    );

    // Run the real applyCommand with the real provision loop, real
    // phantom-preflight and the fake `phantom` binary on PATH. Only doctor is
    // mocked — `stack doctor` probes the vault on its own account and is out
    // of scope here.
    const script = join(dir, "run-apply.ts");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
import { copyFileSync } from "node:fs";
import { setupFakePhantom } from ${JSON.stringify(join(cliDir, "../../core/src/__tests__/_harness.ts"))};
const h = setupFakePhantom();
try {
  mock.module(${JSON.stringify(join(cliDir, "commands/doctor.ts"))}, () => ({
    doctorCommand: { run: async () => {} },
  }));
  const { applyCommand } = await import(${JSON.stringify(join(cliDir, "commands/apply.ts"))});
  await applyCommand.run({ args: { recipeId: "empty", noWire: false, noRollback: false } });
  copyFileSync(h.logPath, "phantom-calls.jsonl");
} finally { h.cleanup(); }
`,
    );
    const result = spawnSync("bun", [script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: home, NO_COLOR: "1", CI: "1" },
      timeout: 20_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("empty applied.");
    // The fake `phantom` logs every invocation; an empty wiring plan must
    // leave the log untouched — no `--version` probe, no `list`, nothing.
    expect(readFileSync(join(dir, "phantom-calls.jsonl"), "utf8").trim()).toBe("");
  });
});
