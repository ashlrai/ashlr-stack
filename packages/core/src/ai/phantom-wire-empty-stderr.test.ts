import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { exec, isPhantomInstalled, listSecrets } from "../phantom.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Each test spawns the fake `phantom` shim (bash + python3).
setDefaultTimeout(30_000);

const RECIPE: Recipe = {
  id: "silent-failure",
  query: "payments",
  createdAt: "2026-04-18T00:00:00.000Z",
  providers: [{ name: "stripe" }, { name: "neon" }],
};

/**
 * Rewrite the harness `phantom`'s `list` arm to exit nonzero without a single
 * stderr byte — a real crash shape (a killed wrapper, a denied helper, a
 * build that prints nothing). `--version` still answers so the install probe
 * passes and `list --json` is the subprocess that fails. The logging preamble
 * is preserved so `callsTo` still sees every spawned command. `stdout`
 * optionally carries output the failed call must not legitimise.
 */
function failListSilently(h: Harness, stdout = ""): void {
  const bin = join(h.dir, "phantom");
  const shim = readFileSync(bin, "utf-8");
  expect(shim).toContain("  list)\n");
  writeFileSync(
    bin,
    shim.replace("  list)\n", `  list)\n    printf '%s' '${stdout}'\n    exit 9\n`),
  );
}

/**
 * Rewrite only the `--version` arm to exit nonzero with empty stderr, so the
 * install probe itself is the silently failing subprocess.
 */
function failVersionSilently(h: Harness): void {
  const bin = join(h.dir, "phantom");
  const shim = readFileSync(bin, "utf-8");
  expect(shim).toContain("  --version)\n");
  writeFileSync(bin, shim.replace("  --version)\n", "  --version)\n    exit 9\n"));
}

describe("ai/phantom-wire when the subprocess exits nonzero with empty stderr", () => {
  let harness: Harness;

  beforeEach(() => {
    // The vault file really holds STRIPE_SECRET_KEY: a successful inventory
    // would report it `present`. The failed `list` must not.
    harness = setupFakePhantom({ STRIPE_SECRET_KEY: "x" });
  });
  afterEach(() => {
    harness.cleanup();
  });

  it("keeps a silently failing inventory distinct from a successful read and reports why", async () => {
    failListSilently(harness);

    // The returned exec failure is distinguishable from success on its own:
    // nonzero code, an "exited" completion, and genuinely empty streams.
    const result = await exec(["list", "--json"], { cwd: harness.dir, allowFailure: true });
    expect(result).toMatchObject({ code: 9, stderr: "", stdout: "", completion: "exited" });
    expect(result.code).not.toBe(0);

    // The thrown diagnostic names the unavailable inventory outright — it
    // never depended on stderr carrying a message.
    await expect(listSecrets(harness.dir)).rejects.toMatchObject({
      code: "PHANTOM_METADATA_UNAVAILABLE",
      message: "Phantom secret inventory is unavailable; stored names are unknown.",
    });

    // Wire keeps both providers in `skipped` — the failure stays
    // distinguishable from a successful read, which would have put
    // `stripe:STRIPE_SECRET_KEY` in `present` and the Neon secrets in
    // `missing`. Neither success-shaped entry may appear.
    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(await wirePhantomForRecipe(RECIPE, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath],
      skipped: ["stripe", "neon"],
    });
    expect(existsSync(stubPath)).toBe(true);
    expect(readFileSync(stubPath, "utf-8")).toContain("stripe-signature");
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("never treats stdout from a silently failed list as a successful inventory", async () => {
    // A plausible-looking payload on stdout does not upgrade a nonzero exit
    // to success: the vault stays unread and every provider is skipped.
    failListSilently(harness, '[{"name":"STRIPE_SECRET_KEY"}]');

    await expect(listSecrets(harness.dir)).rejects.toMatchObject({
      code: "PHANTOM_METADATA_UNAVAILABLE",
    });
    const wire = await wirePhantomForRecipe(RECIPE, { cwd: harness.dir });
    expect(wire.present).toEqual([]);
    expect(wire.missing).toEqual([]);
    expect(wire.skipped).toEqual(["stripe", "neon"]);
    expect(wire.webhooks).toEqual([join(harness.dir, ".stack/webhooks/stripe.ts")]);
  });

  it("maps a silently crashing --version probe to not-installed, never to success", async () => {
    failVersionSilently(harness);

    // The probe reads the nonzero close as missing — distinguishable from an
    // installed phantom — and the typed diagnostic carries the install hint.
    expect(await isPhantomInstalled()).toBe(false);
    await expect(listSecrets(harness.dir)).rejects.toMatchObject({
      code: "PHANTOM_NOT_INSTALLED",
    });

    // Wire skips every provider, still writes the stub, and never reaches
    // the inventory subprocess at all.
    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(await wirePhantomForRecipe(RECIPE, { cwd: harness.dir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath],
      skipped: ["stripe", "neon"],
    });
    expect(existsSync(stubPath)).toBe(true);
    expect(harness.callsTo("--version")).toEqual([{ cmd: "--version", args: [] }]);
    expect(harness.callsTo("list")).toEqual([]);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("keeps the command and exit code in the rejection when stderr is empty", async () => {
    failListSilently(harness);

    // Callers that do not allowFailure get a rejection that still diagnoses:
    // the argv and exit code are interpolated into the message, not the
    // (empty) stderr text.
    await expect(exec(["list", "--json"], { cwd: harness.dir })).rejects.toMatchObject({
      code: "PHANTOM_EXEC_FAILED",
    });
    await expect(exec(["list", "--json"], { cwd: harness.dir })).rejects.toThrow(
      /phantom list --json failed \(exit 9\)/,
    );
  });
});
