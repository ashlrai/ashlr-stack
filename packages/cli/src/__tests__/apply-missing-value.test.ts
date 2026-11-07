import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression: `stack apply` must never write a placeholder for a secret the
 * Phantom vault is missing. Before 0.2.1, wiring attempted
 * `phantom add <KEY> TODO_STACK_APPLY --rotate` for every declared secret;
 * the fix made wiring read-only (`phantom list --json`) plus webhook stubs.
 *
 * These isolated fixtures cover the two paths where a missing value could
 * still tempt a placeholder write:
 *   1. A webhook-capable provider (stripe) — the one wiring path that writes
 *      a project file (`.stack/webhooks/stripe.ts`) while its declared
 *      secret is absent from the vault.
 *   2. A provider that failed to provision — wiring still covers every
 *      recipe provider after the first success, so the failed provider's
 *      missing secret is reported (and its stub still written) without any
 *      placeholder landing in the vault.
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
  const dir = mkdtempSync(join(tmpdir(), "stack-apply-missing-"));
  createdDirs.push(dir);
  return dir;
}

function seedProject(dir: string, recipeId: string, providers: string[]): string {
  mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
  writeFileSync(join(dir, ".stack.toml"), "");
  const header = `id = "${recipeId}"\nquery = "fixture"\ncreatedAt = "2026-11-05T00:00:00.000Z"\n`;
  const blocks = providers.map((name) => `\n[[providers]]\nname = "${name}"\n`).join("");
  const recipe = `${header}${blocks}`;
  const path = join(dir, ".stack", "recipes", `${recipeId}.toml`);
  writeFileSync(path, recipe);
  return recipe;
}

// Runs the real applyCommand + real wirePhantomForRecipe against the fake
// Phantom vault; provisioning, the Phantom preflight prompt, and doctor are
// mocked out (see apply.test.ts for the same isolation pattern). The harness
// script copies the vault and the phantom call log back into the project
// dir so the test can inspect them.
function runApplyScript(dir: string, home: string, scriptBody: string) {
  const script = join(dir, "run-apply.ts");
  writeFileSync(script, scriptBody);
  const result = spawnSync("bun", [script], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1", CI: "1" },
    timeout: 20_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function applyDriver(
  recipeId: string,
  provisionResult: string,
  vaultJson: string,
  trapExit: boolean,
  noWire = false,
): string {
  const mocks = `
mock.module(${JSON.stringify(join(CLI_DIR, "lib/provision-loop.ts"))}, () => ({
  provisionProviders: async () => (${provisionResult}),
}));
mock.module(${JSON.stringify(join(CLI_DIR, "lib/phantom-preflight.ts"))}, () => ({
  requirePhantom: async () => {},
}));
mock.module(${JSON.stringify(join(CLI_DIR, "commands/doctor.ts"))}, () => ({
  doctorCommand: { run: async () => {} },
}));
const { applyCommand } = await import(${JSON.stringify(join(CLI_DIR, "commands/apply.ts"))});`;
  const exitTrap = trapExit
    ? // outroError ends a failed apply with process.exit(1); trap it so the
      // post-failure vault and filesystem state stay inspectable.
      `process.exit = ((code?: number) => { throw new Error("EXIT " + code); }) as typeof process.exit;
try {
  await applyCommand.run({ args: { recipeId: ${JSON.stringify(recipeId)}, noWire: ${noWire}, noRollback: false } });
  console.log("APPLY-RETURNED");
} catch (err) {
  console.log("APPLY-EXIT " + (err as Error).message);
}`
    : `await applyCommand.run({ args: { recipeId: ${JSON.stringify(recipeId)}, noWire: ${noWire}, noRollback: false } });`;
  return `import { mock } from "bun:test";
import { copyFileSync } from "node:fs";
import { setupFakePhantom } from ${JSON.stringify(join(CLI_DIR, "../../core/src/__tests__/_harness.ts"))};
const h = setupFakePhantom(${vaultJson});
try {
${mocks}
${exitTrap}
  copyFileSync(h.vaultPath, "vault-result.json");
  copyFileSync(h.logPath, "phantom-calls.jsonl");
} finally { h.cleanup(); }
`;
}

function readCalls(dir: string): Array<{ cmd: string; args: string[] }> {
  return readFileSync(join(dir, "phantom-calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { cmd: string; args: string[] });
}

describe("stack apply — missing vault value", () => {
  for (const initial of [{}, { OPENAI_API_KEY: "sk-test-existing-not-real" }]) {
    it(`preserves a ${Object.keys(initial).length ? "partially populated" : "empty"} vault while wiring two providers`, () => {
      const dir = mkTmp();
      const home = mkTmp();
      seedProject(dir, "ai-and-payments", ["openai", "stripe"]);
      const body = applyDriver(
        "ai-and-payments",
        '{ succeeded: ["openai", "stripe"], failures: [] }',
        JSON.stringify(initial),
        false,
      );
      const { stdout, stderr, status } = runApplyScript(dir, home, body);
      expect(status).toBe(0);
      expect(stdout).toContain("missing");
      expect(stdout).toContain("STRIPE_SECRET_KEY");
      const calls = readCalls(dir);
      expect(calls).toEqual([
        { cmd: "--version", args: [] },
        { cmd: "list", args: ["--json"] },
      ]);
      expect(calls.flatMap((call) => call.args)).not.toContain(MARKER);
      expect(stdout + stderr).not.toContain(MARKER);
      for (const value of Object.values(initial)) expect(stdout + stderr).not.toContain(value);
      expect(JSON.parse(readFileSync(join(dir, "vault-result.json"), "utf8"))).toEqual(initial);
    });
  }

  it("reports the missing secret and writes only the webhook stub, never a placeholder", () => {
    const dir = mkTmp();
    const home = mkTmp();
    const recipe = seedProject(dir, "billing", ["stripe"]);
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");

    const body = applyDriver(
      "billing",
      '{ succeeded: ["stripe"], failures: [] }',
      '{ UNRELATED_TOKEN: "real-vault-value" }',
      false,
    );
    const { stdout, stderr, status } = runApplyScript(dir, home, body);

    expect(status).toBe(0);
    // The declared secret is reported missing; the unrelated vault entry is
    // not a recipe secret so it isn't counted as present.
    expect(stdout).toContain("missing 1");
    expect(stdout).toContain("STRIPE_SECRET_KEY");
    expect(stdout).toContain("phantom add <NAME>");
    expect(stdout).toContain("webhooks 1");

    // The only write apply performs is the webhook stub — it must carry no
    // placeholder and no real vault value.
    expect(existsSync(stubPath)).toBe(true);
    const stub = readFileSync(stubPath, "utf8");
    expect(stub).not.toContain(MARKER);
    expect(stub).not.toContain("real-vault-value");
    expect(stub).not.toContain("STRIPE_SECRET_KEY");

    // The vault is byte-for-byte what the fixture seeded: no new entry for
    // the missing name, no placeholder value, no churn on the present one.
    expect(JSON.parse(readFileSync(join(dir, "vault-result.json"), "utf8"))).toEqual({
      UNRELATED_TOKEN: "real-vault-value",
    });

    // Phantom was only read: one install probe and one names-only listing.
    // No add/remove/reveal — nothing that could carry a value.
    const calls = readCalls(dir);
    expect(calls).toEqual([
      { cmd: "--version", args: [] },
      { cmd: "list", args: ["--json"] },
    ]);

    expect(stdout + stderr).not.toContain(MARKER);
    expect(readFileSync(join(dir, ".stack", "recipes", "billing.toml"), "utf8")).toBe(recipe);
  });

  it("still reports a failed provider's missing secret without writing a placeholder", () => {
    const dir = mkTmp();
    const home = mkTmp();
    seedProject(dir, "mixed", ["neon", "stripe"]);
    const stubPath = join(dir, ".stack", "webhooks", "stripe.ts");

    // Stripe fails provisioning, neon succeeds: wiring covers every provider
    // in the recipe including the failed one, then apply exits 1.
    const body = applyDriver(
      "mixed",
      '{ succeeded: ["neon"], failures: [{ name: "stripe", message: "oauth declined" }] }',
      "{}",
      true,
    );
    const { stdout, stderr, status } = runApplyScript(dir, home, body);

    expect(status).toBe(0);
    // Apply failed overall (outroError → exit 1, trapped by the harness) and
    // still surfaced every missing secret, including the failed provider's.
    expect(stdout).toContain("APPLY-EXIT EXIT 1");
    expect(stdout).toContain("missing 3");
    expect(stdout).toContain("NEON_API_KEY, DATABASE_URL, STRIPE_SECRET_KEY");
    expect(stdout + stderr).toContain("Some providers failed: stripe");

    // Even the failed provider's webhook stub lands — and it carries no
    // placeholder.
    expect(existsSync(stubPath)).toBe(true);
    expect(readFileSync(stubPath, "utf8")).not.toContain(MARKER);

    // Empty vault stayed empty: nothing was added for the missing names.
    expect(JSON.parse(readFileSync(join(dir, "vault-result.json"), "utf8"))).toEqual({});
    const calls = readCalls(dir);
    expect(calls).toEqual([
      { cmd: "--version", args: [] },
      { cmd: "list", args: ["--json"] },
    ]);
    expect(stdout + stderr).not.toContain(MARKER);
  });

  it("does not fail apply for a missing name alone", () => {
    const dir = mkTmp();
    const home = mkTmp();
    seedProject(dir, "billing", ["stripe"]);

    const body = applyDriver("billing", '{ succeeded: ["stripe"], failures: [] }', "{}", true);
    const { stdout, status } = runApplyScript(dir, home, body);

    expect(status).toBe(0);
    expect(stdout).toContain("missing 1");
    expect(stdout).toContain("APPLY-RETURNED");
    expect(stdout).not.toContain("APPLY-EXIT");
  });

  it("does not wire when no provider succeeded", () => {
    const dir = mkTmp();
    const home = mkTmp();
    seedProject(dir, "all-failed", ["stripe"]);

    const body = applyDriver(
      "all-failed",
      '{ succeeded: [], failures: [{ name: "stripe", message: "oauth declined" }] }',
      "{}",
      true,
    );
    const { stdout, stderr, status } = runApplyScript(dir, home, body);

    expect(status).toBe(0);
    expect(stdout).toContain("APPLY-EXIT EXIT 1");
    expect(stdout + stderr).toContain("Some providers failed: stripe");
    expect(stdout).not.toContain("secrets in vault");
    expect(existsSync(join(dir, ".stack", "webhooks"))).toBe(false);
    expect(readCalls(dir)).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "vault-result.json"), "utf8"))).toEqual({});
  });

  it("skips both the inventory check and webhook stubs with --noWire", () => {
    const dir = mkTmp();
    const home = mkTmp();
    seedProject(dir, "billing", ["stripe"]);

    const body = applyDriver(
      "billing",
      '{ succeeded: ["stripe"], failures: [] }',
      "{}",
      true,
      true,
    );
    const { stdout, status } = runApplyScript(dir, home, body);

    expect(status).toBe(0);
    expect(stdout).toContain("APPLY-RETURNED");
    expect(stdout).not.toContain("secrets in vault");
    expect(existsSync(join(dir, ".stack", "webhooks"))).toBe(false);
    expect(readCalls(dir)).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "vault-result.json"), "utf8"))).toEqual({});
  });
});
