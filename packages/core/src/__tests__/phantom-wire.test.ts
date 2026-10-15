import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import type { Recipe } from "../ai/recipe.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("ai/phantom-wire", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = setupFakePhantom();
  });
  afterEach(() => {
    harness.cleanup();
  });

  const STRIPE_RECIPE: Recipe = {
    id: "stripe-only",
    query: "payments",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: [{ name: "stripe" }],
  };

  it("attempts `phantom add STRIPE_SECRET_KEY`, stores no placeholder, and writes a webhook stub", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });

    // Phantom Secrets >= 0.7.3 rejects `--rotate` and positional values, so the
    // placeholder envelope never lands (see phantom-contract.test.ts).
    expect(result.envelopes).toEqual([]);
    const adds = harness.callsTo("add");
    const keys = adds.flatMap((c) => c.args);
    expect(keys).toContain("STRIPE_SECRET_KEY");
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});

    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(existsSync(stubPath)).toBe(true);
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toContain("stripe-signature");
    expect(stub).toContain("STRIPE_WEBHOOK_SECRET");
    expect(result.webhooks).toHaveLength(1);
  });

  it("noWire: true skips envelopes and webhooks entirely", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, {
      cwd: harness.dir,
      noWire: true,
    });
    expect(result).toEqual({ envelopes: [], webhooks: [], skipped: [] });

    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(existsSync(stubPath)).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
  });

  it("writes no placeholder envelopes for a multi-secret provider", async () => {
    const recipe: Recipe = {
      id: "supa",
      query: "database",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [{ name: "supabase" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.envelopes).toEqual([]);
    expect(harness.callsTo("add").map((c) => c.args[0])).toEqual([
      "SUPABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    // Supabase is webhook-capable in our moat list.
    expect(result.webhooks).toHaveLength(1);
  });

  it("skips providers with no webhook stub without crashing", async () => {
    const recipe: Recipe = {
      id: "neon",
      query: "database",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [{ name: "neon" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.webhooks).toEqual([]);
    expect(result.envelopes).toEqual([]);
    expect(harness.callsTo("add").length).toBeGreaterThan(0);
  });
});
