import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import { type Recipe, readRecipe, writeRecipe } from "../ai/recipe.ts";
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

  it("never writes to the vault, reports the missing secret, and writes a webhook stub", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });

    // Phantom Secrets refuses values in argv and denies overwriting names, so
    // apply must not try to plant placeholders. It only reads names.
    expect(harness.callsTo("add")).toEqual([]);
    expect(harness.callsTo("list")).toEqual([{ cmd: "list", args: ["--json"] }]);
    expect(JSON.parse(readFileSync(harness.vaultPath, "utf-8"))).toEqual({});
    expect(result.present).toEqual([]);
    expect(result.missing).toContain("stripe:STRIPE_SECRET_KEY");

    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(existsSync(stubPath)).toBe(true);
    const stub = readFileSync(stubPath, "utf-8");
    expect(stub).toContain("stripe-signature");
    expect(stub).toContain("STRIPE_WEBHOOK_SECRET");
    expect(result.webhooks).toHaveLength(1);
  });

  it("wires an altered local recipe without authenticating its contents", async () => {
    const path = await writeRecipe(STRIPE_RECIPE, harness.dir);
    const original = readFileSync(path, "utf-8");
    expect(original).toContain("stripe");
    writeFileSync(path, original.replace('stripe"', 'github"'));

    const recipe = await readRecipe(STRIPE_RECIPE.id, harness.dir);
    expect(recipe.providers).toEqual([{ name: "github" }]);
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.missing).toContain("github:GITHUB_TOKEN");
    expect(result.webhooks).toEqual([join(harness.dir, ".stack/webhooks/github.ts")]);
  });

  it.each([
    ["stripe", "stripe-signature", "handleStripeWebhook"],
    ["clerk", "svix-signature", "handleClerkWebhook"],
    ["supabase", "x-supabase-signature", "handleSupabaseWebhook"],
    ["github", "x-hub-signature-256", "handleGithubWebhook"],
  ])("rejects a missing signature in the generated %s example", async (provider, header, name) => {
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: [{ name: provider }] };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.webhooks).toHaveLength(1);

    const stub = readFileSync(result.webhooks[0], "utf-8");
    expect(stub).toContain(
      "The body is unverified; a present signature header does not authenticate it.",
    );
    const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
    if (!example) throw new Error(`Missing ${provider} webhook example`);
    const examplePath = join(harness.dir, `${provider}-example.ts`);
    writeFileSync(examplePath, example.replace(/^\/\/ ?/gm, ""));
    const handler: unknown = (await import(examplePath))[name];
    expect(typeof handler).toBe("function");
    if (typeof handler !== "function") throw new Error(`Missing ${name}`);

    const missingHeaders: HeadersInit[] = [
      {},
      { "x-unrelated-signature": "present" },
      { [header]: "" },
    ];
    for (const headers of missingHeaders) {
      const response: Response = await handler(new Request("https://example.com", { headers }));
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing signature");
    }

    // A non-empty header reaches the placeholder; it is not signature verification.
    const response: Response = await handler(
      new Request("https://example.com", {
        method: "POST",
        headers: { [header]: "placeholder" },
        body: "unverified webhook payload",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("noWire: true skips the vault check and webhooks entirely", async () => {
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, {
      cwd: harness.dir,
      noWire: true,
    });
    expect(result).toEqual({ present: [], missing: [], webhooks: [], skipped: [] });

    const stubPath = join(harness.dir, ".stack/webhooks/stripe.ts");
    expect(existsSync(stubPath)).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
    expect(harness.callsTo("list")).toEqual([]);
  });

  it("splits a multi-secret provider into present and missing", async () => {
    harness.cleanup();
    harness = setupFakePhantom({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "a" });
    const recipe: Recipe = {
      id: "supa",
      query: "database",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [{ name: "supabase" }],
    };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
    expect(result.present).toEqual(["supabase:SUPABASE_URL", "supabase:SUPABASE_ANON_KEY"]);
    expect(result.missing).toEqual(["supabase:SUPABASE_SERVICE_ROLE_KEY"]);
    expect(result.skipped).toEqual([]);
    expect(harness.callsTo("add")).toEqual([]);
    // Supabase is webhook-capable in our moat list.
    expect(result.webhooks).toHaveLength(1);
  });

  it("skips providers when the vault can't be listed, but still writes stubs", async () => {
    writeFileSync(harness.vaultPath, "not json");
    const result = await wirePhantomForRecipe(STRIPE_RECIPE, { cwd: harness.dir });
    expect(result.skipped).toEqual(["stripe"]);
    expect(result.present).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.webhooks).toHaveLength(1);
    expect(harness.callsTo("add")).toEqual([]);
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
    expect(result.missing.length).toBeGreaterThan(0);
  });
});
