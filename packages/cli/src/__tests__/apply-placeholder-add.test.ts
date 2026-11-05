import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Harness, readVault, setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";

/**
 * Regression: `stack apply` used to run `phantom add <KEY> TODO_STACK_APPLY`
 * (first with --rotate, then without) for every declared secret missing from
 * the vault. Phantom refuses positional values, so those calls only ever
 * failed — but had one landed, the placeholder would have sat in the vault
 * blocking the real value. Wiring must only read the vault: a missing value
 * must never produce an `add` invocation carrying TODO_STACK_APPLY.
 */

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "TODO_STACK_APPLY";

const createdDirs: string[] = [];
const harnesses: Harness[] = [];

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.cleanup();
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

// Each case spawns a `bun` process that loads the real applyCommand; on
// loaded machines a single spawn can take several seconds.
setDefaultTimeout(30_000);

describe("stack apply — placeholder secrets", () => {
  const vaults: Record<string, string>[] = [{}, { OPENAI_API_KEY: "sk-test-existing-not-real" }];
  for (const initial of vaults) {
    it(`never runs \`phantom add <KEY> ${MARKER}\` for a missing value (vault ${JSON.stringify(initial)})`, async () => {
      // The stubbed `phantom` goes on PATH for this process; the spawned
      // runner below inherits it and logs every invocation.
      const h = setupFakePhantom(initial);
      harnesses.push(h);
      const dir = mkTmp("stack-apply-placeholder-");
      const home = mkTmp("stack-apply-home-");

      // An existing .stack.toml keeps auto-init out of the way. The recipe
      // declares openai + stripe, so STRIPE_SECRET_KEY is missing from the
      // vault in both cases — the trigger for the old placeholder writes.
      writeFileSync(join(dir, ".stack.toml"), "");
      mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
      writeFileSync(
        join(dir, ".stack", "recipes", "ai-and-payments.toml"),
        'id = "ai-and-payments"\nquery = "ai and payments"\ncreatedAt = "2026-11-05T00:00:00.000Z"\n\n[[providers]]\nname = "openai"\n\n[[providers]]\nname = "stripe"\n',
      );

      // Run the real applyCommand with the real wiring step against the
      // stubbed `phantom`. Provisioning, preflight and doctor are mocked —
      // provider tokens are out of scope; the vault interaction is under test.
      const script = join(dir, "run-apply.ts");
      writeFileSync(
        script,
        `import { mock } from "bun:test";
mock.module(${JSON.stringify(join(CLI_DIR, "lib/provision-loop.ts"))}, () => ({
  provisionProviders: async () => ({ succeeded: ["openai", "stripe"], failures: [] }),
}));
mock.module(${JSON.stringify(join(CLI_DIR, "lib/phantom-preflight.ts"))}, () => ({
  requirePhantom: async () => {},
}));
mock.module(${JSON.stringify(join(CLI_DIR, "commands/doctor.ts"))}, () => ({
  doctorCommand: { run: async () => {} },
}));
const { applyCommand } = await import(${JSON.stringify(join(CLI_DIR, "commands/apply.ts"))});
await applyCommand.run({ args: { recipeId: "ai-and-payments", noWire: false, noRollback: false } });
`,
      );
      const result = spawnSync("bun", [script], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1", CI: "1" },
        timeout: 20_000,
      });
      expect(result.status).toBe(0);

      // The missing value was actually reported — without this, the "no add"
      // assertions below would be vacuous.
      expect(result.stdout).toContain("missing");
      expect(result.stdout).toContain("STRIPE_SECRET_KEY");

      // Acceptance: no `add` call carried the placeholder. Stronger still:
      // wiring issues no `add` calls at all, no invocation of any subcommand
      // mentions the marker, and no stored value leaks into the output.
      const addCalls = h.callsTo("add");
      expect(addCalls.flatMap((call) => call.args)).not.toContain(MARKER);
      expect(addCalls).toEqual([]);
      expect(h.calls().flatMap((call) => call.args)).not.toContain(MARKER);
      const output = result.stdout + result.stderr;
      expect(output).not.toContain(MARKER);
      for (const value of Object.values(initial)) {
        expect(output).not.toContain(value);
      }

      // The vault was only read (`list --json`) and is unchanged.
      expect(h.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
      expect(await readVault(h.dir)).toEqual(initial);
    });
  }
});
