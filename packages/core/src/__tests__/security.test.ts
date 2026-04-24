import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { addSecret, exec, revealSecret } from "../phantom.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * Regression tests for the Wave 9 security review findings. Each test here
 * guards against a specific historical vulnerability — breaking any of these
 * should be treated as a gating regression.
 */

describe("security — secret redaction in error messages", () => {
  let h: Harness;
  beforeEach(() => {
    h = setupFakePhantom();
    // Put a fake `phantom` on PATH that always fails on `add`, so we can
    // trigger the error path that used to leak secret values.
    Bun.write(
      `${h.dir}/phantom`,
      `#!/usr/bin/env bash
case "$1" in
  --version) echo "phantom fake 0.0.1" ;;
  add) echo "simulated failure" >&2; exit 7 ;;
  *) echo "ok" ;;
esac
`,
    ).then(() => Bun.spawn(["chmod", "+x", `${h.dir}/phantom`]).exited);
  });
  afterEach(() => h.cleanup());

  test("error thrown by `phantom add <K> <V>` does not contain the secret value", async () => {
    // Give it a moment for the chmod/write to settle.
    await Bun.spawn(["chmod", "+x", `${h.dir}/phantom`]).exited;
    let caught: Error | undefined;
    try {
      await exec(["add", "MY_KEY", "super-secret-value-XYZ123"]);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).not.toContain("super-secret-value-XYZ123");
    expect(caught?.message).toContain("<redacted>");
  });
});

describe("security — fake phantom harness handles hostile secret values", () => {
  let h: Harness;
  beforeEach(() => {
    h = setupFakePhantom();
  });
  afterEach(() => h.cleanup());

  test("a secret containing single quotes does not break the harness", async () => {
    const hostile = `value-with-'-quote-and-\"-and-$VAR-and-\\backslash`;
    await addSecret("HOSTILE_KEY", hostile);
    const revealed = await revealSecret("HOSTILE_KEY");
    expect(revealed).toBe(hostile);
    const vault = await readVault(h.dir);
    expect(vault.HOSTILE_KEY).toBe(hostile);
  });

  test("a secret containing a newline survives round-trip", async () => {
    const hostile = "first-line\n-second-line";
    await addSecret("MULTILINE_KEY", hostile);
    // revealSecret trims trailing whitespace via stdout.trim() — that's fine,
    // but round-tripping the full value via the vault file should preserve it.
    const vault = await readVault(h.dir);
    expect(vault.MULTILINE_KEY).toBe(hostile);
  });

  test("a secret that looks like a Python expression is stored literally", async () => {
    const hostile = `'; import os; os.system('echo pwned > /tmp/STACK_PWNED'); '`;
    await addSecret("PYTHON_INJECTION_KEY", hostile);
    const vault = await readVault(h.dir);
    expect(vault.PYTHON_INJECTION_KEY).toBe(hostile);
    // Sanity: the marker file must NOT exist — if the injection had fired,
    // this file would have been created by /tmp/STACK_PWNED.
    const { existsSync } = await import("node:fs");
    expect(existsSync("/tmp/STACK_PWNED")).toBe(false);
  });
});
