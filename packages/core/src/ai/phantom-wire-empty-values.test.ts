import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Each test spawns the fake `phantom` shim (bash + python3).
setDefaultTimeout(30_000);

const EMPTY_RESULT = { present: [], missing: [], webhooks: [], skipped: [] };

describe("ai/phantom-wire empty set of requested values", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "stack wire empty-values-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "empty-values",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  const vaultText = () => readFileSync(harness.vaultPath, "utf-8");
  // Every logged phantom call must be a read: the install probe or `list`.
  // A placeholder write could only arrive through `add`/`init`/`remove`/`sync`.
  const onlyReadCalls = () =>
    harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list");

  it("writes no placeholder for a recipe with no providers", async () => {
    const before = vaultText();
    const result = await wirePhantomForRecipe(recipe(), { cwd: dir });

    // Nothing was requested, so nothing can be present, missing, skipped or
    // stubbed — the documented empty result.
    expect(result).toEqual(EMPTY_RESULT);
    expect(onlyReadCalls()).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    // The vault file is byte-identical and no placeholder artifact lands on
    // disk: no `.stack/` tree, no `.env`, nothing.
    expect(vaultText()).toBe(before);
    expect(JSON.parse(vaultText())).toEqual({});
    expect(readdirSync(dir)).toEqual([]);
  });

  it("leaves a populated vault byte-identical when nothing is requested", async () => {
    writeFileSync(
      harness.vaultPath,
      JSON.stringify({ STRIPE_SECRET_KEY: "stored-real-value", GITHUB_TOKEN: "gh-tok" }),
    );
    const before = vaultText();

    const result = await wirePhantomForRecipe(recipe(), { cwd: dir });

    // An empty request reports nothing — not even the stored names — and
    // must not reconcile the vault: nothing moves to `present`, no stored
    // name is dropped or rewritten.
    expect(result).toEqual(EMPTY_RESULT);
    expect(onlyReadCalls()).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(vaultText()).toBe(before);
    expect(JSON.parse(vaultText())).toEqual({
      STRIPE_SECRET_KEY: "stored-real-value",
      GITHUB_TOKEN: "gh-tok",
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes no placeholder when every named provider misses the catalog", async () => {
    const before = vaultText();
    const result = await wirePhantomForRecipe(recipe("nope", "also-nope"), { cwd: dir });

    // Unknown names resolve no secret list, so the requested set stays
    // empty: they are reported skipped, never missing, and no stub lands.
    expect(result).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: ["nope", "also-nope"],
    });
    expect(onlyReadCalls()).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(vaultText()).toBe(before);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes no placeholder when the vault cannot be read", async () => {
    // Corrupt the vault file so `list --json` exits nonzero. The requested
    // set is still empty and the failed read must not trigger a write.
    writeFileSync(harness.vaultPath, "not json");

    const result = await wirePhantomForRecipe(recipe(), { cwd: dir });

    expect(result).toEqual(EMPTY_RESULT);
    expect(onlyReadCalls()).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    // The unreadable file is left alone — no repair write, no placeholder.
    expect(vaultText()).toBe("not json");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("spawns nothing at all when the empty request opts out with noWire", async () => {
    const before = vaultText();
    const result = await wirePhantomForRecipe(recipe(), { cwd: dir, noWire: true });

    expect(result).toEqual(EMPTY_RESULT);
    expect(harness.calls()).toEqual([]);
    expect(vaultText()).toBe(before);
    expect(existsSync(join(dir, ".stack"))).toBe(false);
  });
});
