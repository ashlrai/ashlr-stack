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

/**
 * Regression: `stack apply` used to run `phantom add <KEY> TODO_STACK_APPLY`
 * (first with --rotate, then without) for every declared secret missing from
 * the vault. With two missing values the buggy wiring issued two placeholder
 * writes — both refused by Phantom, but had either landed the placeholder
 * would have sat under the real name blocking the true value. The vault
 * check must leave both names absent: neither missing value may be replaced
 * by a placeholder in the vault, the output, or any file on disk.
 */

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "TODO_STACK_APPLY";
const MISSING = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

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

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// The test spawns a `bun` process that loads the real apply command; on
// loaded machines a single spawn can take several seconds.
setDefaultTimeout(30_000);

describe("stack apply — two missing values", () => {
  it("reports both missing values and replaces neither with a placeholder", () => {
    const dir = mkTmp();
    const home = mkTmp();

    // An existing .stack.toml keeps auto-init out of the way. The recipe
    // names cloudflare, which declares exactly two secrets; the fake vault
    // starts empty so both values are missing — the old wiring would have
    // fired two `phantom add <KEY> TODO_STACK_APPLY` calls here.
    writeFileSync(join(dir, ".stack.toml"), "");
    mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
    writeFileSync(
      join(dir, ".stack", "recipes", "edge.toml"),
      'id = "edge"\nquery = "workers and cdn"\ncreatedAt = "2026-11-05T00:00:00.000Z"\n\n[[providers]]\nname = "cloudflare"\n',
    );

    // The real applyCommand runs the real wiring step against the fake
    // `phantom` (empty vault, every invocation logged). Provisioning,
    // preflight and doctor are mocked — provider tokens are out of scope;
    // the vault interaction is under test.
    const script = join(dir, "run-apply.ts");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
import { copyFileSync } from "node:fs";
import { setupFakePhantom } from ${JSON.stringify(join(CLI_DIR, "../../core/src/__tests__/_harness.ts"))};
const h = setupFakePhantom();
try {
  mock.module(${JSON.stringify(join(CLI_DIR, "lib/provision-loop.ts"))}, () => ({
    provisionProviders: async () => ({ succeeded: ["cloudflare"], failures: [] }),
  }));
  mock.module(${JSON.stringify(join(CLI_DIR, "lib/phantom-preflight.ts"))}, () => ({
    requirePhantom: async () => {},
  }));
  mock.module(${JSON.stringify(join(CLI_DIR, "commands/doctor.ts"))}, () => ({
    doctorCommand: { run: async () => {} },
  }));
  const { applyCommand } = await import(${JSON.stringify(join(CLI_DIR, "commands/apply.ts"))});
  await applyCommand.run({ args: { recipeId: "edge", noWire: false, noRollback: false } });
  copyFileSync(h.vaultPath, "vault-result.json");
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
    if (result.status !== 0) console.error(result.stdout, result.stderr);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("edge applied.");

    // Both values were actually reported missing — without this, the
    // placeholder assertions below would be vacuous.
    expect(result.stdout).toContain("secrets in vault 0");
    expect(result.stdout).toContain("missing 2");
    expect(result.stdout).toContain(`${MISSING[0]}, ${MISSING[1]}`);

    // Neither missing value was replaced by a placeholder: the vault has
    // no entry for either name — absent entirely, not stored under any
    // value — and the marker appears nowhere in the output.
    const vault = JSON.parse(readFileSync(join(dir, "vault-result.json"), "utf8"));
    expect(vault).toEqual({});
    for (const name of MISSING) {
      expect(vault[name]).toBeUndefined();
      expect(vault[name]).not.toBe(MARKER);
    }
    expect(result.stdout + result.stderr).not.toContain(MARKER);

    // The vault was only read: a single `list --json`, no add/remove/init,
    // and no invocation anywhere carried the marker.
    const calls = readFileSync(join(dir, "phantom-calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { cmd: string; args: string[] });
    expect(calls.filter((call) => call.cmd === "list")).toEqual([
      { cmd: "list", args: ["--json"] },
    ]);
    expect(calls.filter((call) => ["add", "remove", "init"].includes(call.cmd))).toEqual([]);
    expect(calls.flatMap((call) => call.args)).not.toContain(MARKER);

    // cloudflare has no webhook stub and apply must not invent one; the
    // project config is left byte-identical.
    expect(existsSync(join(dir, ".stack", "webhooks"))).toBe(false);
    expect(readFileSync(join(dir, ".stack.toml"), "utf8")).toBe("");

    // No file left behind — project or HOME — mentions the placeholder.
    for (const root of [dir, home]) {
      for (const file of walk(root)) {
        expect(readFileSync(file, "utf8")).not.toContain(MARKER);
      }
    }
  });
});
