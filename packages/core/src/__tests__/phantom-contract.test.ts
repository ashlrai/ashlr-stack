import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import { StackError } from "../errors.ts";
import {
  __resetPhantomCache,
  addSecret,
  isPhantomInstalled,
  listSecrets,
  removeSecret,
  revealSecret,
} from "../phantom.ts";
import { takeRevealRefusals, tryRevealSecret } from "../providers/_helpers.ts";

/**
 * Producer/consumer contract: Stack's Phantom wrapper against a REAL
 * `phantom` binary (Phantom Secrets 0.7.9 or newer).
 *
 * The fake in `_harness.ts` encodes what Stack assumes Phantom does; this
 * suite checks those assumptions against the producer. It is opt-in because
 * CI does not install Phantom:
 *
 *   STACK_PHANTOM_CONTRACT_BIN=/abs/path/to/phantom bun test phantom-contract
 *
 * The vault is an isolated encrypted-file vault under a temp HOME, unlocked
 * with a throwaway passphrase. No keychain, network or real credential is used.
 * Tests share that vault and run in order: later tests rely on names stored
 * by earlier ones.
 */

const realBin = process.env.STACK_PHANTOM_CONTRACT_BIN;
const enabled = Boolean(realBin && isAbsolute(realBin));

const SYNTHETIC_VALUE = "stack-contract-synthetic-value-7f3e";

describe.skipIf(!enabled)("phantom CLI contract (real binary)", () => {
  let root = "";
  let project = "";
  const saved: Record<string, string | undefined> = {};
  const cwd = process.cwd();

  function phantom(args: string[], input?: string) {
    return spawnSync("phantom", args, {
      cwd: project,
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  function vaultNames(): string[] {
    const out = phantom(["list", "--json"]);
    expect(out.status).toBe(0);
    return (JSON.parse(out.stdout) as Array<{ name: string }>).map((e) => e.name).sort();
  }

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "stack-phantom-contract-")));
    const bin = join(root, "bin");
    project = join(root, "project");
    mkdirSync(bin);
    mkdirSync(project);
    mkdirSync(join(root, "home"));
    symlinkSync(realBin as string, join(bin, "phantom"));
    for (const k of ["PATH", "HOME", "PHANTOM_VAULT_PASSPHRASE", "RUST_BACKTRACE"]) {
      saved[k] = process.env[k];
    }
    process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
    process.env.HOME = join(root, "home");
    process.env.PHANTOM_VAULT_PASSPHRASE = "stack-contract-throwaway-passphrase";
    process.env.RUST_BACKTRACE = "0";
    __resetPhantomCache();
    spawnSync("git", ["init", "-q"], { cwd: project });
    const init = phantom(["init", "--empty"]);
    expect(init.status).toBe(0);
    process.chdir(project);
  });

  afterAll(() => {
    process.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetPhantomCache();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test("version probe detects the binary", async () => {
    expect(await isPhantomInstalled()).toBe(true);
  });

  // Argv is asserted against the fake in phantom-harness.test.ts; the real
  // binary rejects a positional value, so storing at all proves stdin.
  test("addSecret stores a new name", async () => {
    await addSecret("STACK_CONTRACT_A", SYNTHETIC_VALUE, project);
    expect(vaultNames()).toContain("STACK_CONTRACT_A");
  });

  test("listSecrets returns exactly the stored names", async () => {
    await addSecret("STACK_CONTRACT_B", SYNTHETIC_VALUE, project);
    expect((await listSecrets(project)).sort()).toEqual(vaultNames());
  });

  test("completed identical creates refuse with typed errors and preserve the full name inventory", async () => {
    await addSecret("STACK_CONTRACT_C", SYNTHETIC_VALUE, project);
    const names = vaultNames();
    expect(names).toContain("STACK_CONTRACT_C");
    for (let repeat = 0; repeat < 2; repeat++) {
      let caught: unknown;
      try {
        await addSecret("STACK_CONTRACT_C", SYNTHETIC_VALUE, project);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(StackError);
      if (!(caught instanceof StackError)) throw new Error("Expected a typed collision.");
      expect(caught.code).toBe("PHANTOM_SECRET_EXISTS");
      expect(caught.message).not.toContain(SYNTHETIC_VALUE);
      expect(vaultNames()).toEqual(names);
    }
  });

  // Phantom offers no headless read, so only the name's survival is observable.
  test("addSecret on an existing name fails with a typed error and keeps the name", async () => {
    let caught: unknown;
    try {
      await addSecret("STACK_CONTRACT_A", "replacement-value", project);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StackError);
    expect((caught as StackError).code).toBe("PHANTOM_SECRET_EXISTS");
    expect((caught as StackError).message).not.toContain("replacement-value");
    expect(vaultNames()).toContain("STACK_CONTRACT_A");
  });

  test("revealSecret without a terminal fails closed with a typed error", async () => {
    let caught: unknown;
    try {
      await revealSecret("STACK_CONTRACT_A", project);
    } catch (err) {
      caught = err;
    }
    expect((caught as StackError).code).toBe("PHANTOM_TRUSTED_TERMINAL_REQUIRED");
    expect(String((caught as Error).message)).not.toContain(SYNTHETIC_VALUE);
    takeRevealRefusals();
    expect(await tryRevealSecret("STACK_CONTRACT_A")).toBeUndefined();
    // Doctor relies on this to report "stored, unverified" instead of "missing".
    expect(takeRevealRefusals()).toEqual(["STACK_CONTRACT_A"]);
  });

  test("removeSecret without a terminal reports that nothing was removed", async () => {
    expect(await removeSecret("STACK_CONTRACT_B", project)).toBe(false);
    expect(vaultNames()).toContain("STACK_CONTRACT_B");
  });

  test("recipe wiring never writes placeholder values into the vault", async () => {
    const before = vaultNames();
    const result = await wirePhantomForRecipe(
      {
        id: "contract",
        query: "contract",
        createdAt: new Date(0).toISOString(),
        providers: [{ name: "openai" }],
      },
      { cwd: project },
    );
    expect(result.envelopes).toEqual([]);
    expect(vaultNames()).toEqual(before);
  });
});
