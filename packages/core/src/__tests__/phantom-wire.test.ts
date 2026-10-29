import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

  it("generates a complete commented handler with both response paths for each webhook provider", async () => {
    const providers = [
      {
        name: "stripe",
        handler: "Stripe",
        header: "stripe-signature",
        secret: "STRIPE_WEBHOOK_SECRET",
      },
      { name: "clerk", handler: "Clerk", header: "svix-signature", secret: "CLERK_WEBHOOK_SECRET" },
      {
        name: "supabase",
        handler: "Supabase",
        header: "x-supabase-signature",
        secret: "SUPABASE_WEBHOOK_SECRET",
      },
      {
        name: "github",
        handler: "Github",
        header: "x-hub-signature-256",
        secret: "GITHUB_WEBHOOK_SECRET",
      },
    ];
    const recipe: Recipe = { ...STRIPE_RECIPE, providers: providers.map(({ name }) => ({ name })) };
    const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });

    expect(result.webhooks).toHaveLength(providers.length);
    for (const { name, handler, header, secret } of providers) {
      const path = join(harness.dir, `.stack/webhooks/${name}.ts`);
      expect(result.webhooks).toContain(path);
      const stub = readFileSync(path, "utf-8");
      expect(stub).toContain(`//   phantom reveal ${secret}`);
      expect(stub).toContain(
        [
          `// export async function handle${handler}Webhook(req: Request): Promise<Response> {`,
          `//   const signature = req.headers.get("${header}");`,
          '//   if (!signature) return new Response("missing signature", { status: 400 });',
          "//   const body = await req.text();",
          "//   // TODO: verify(signature, body) before trusting.",
          '//   return new Response("ok", { status: 200 });',
          "// }",
        ].join("\n"),
      );
    }
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
