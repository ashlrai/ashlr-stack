import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import type { Recipe } from "../ai/recipe.ts";
import type { WebhookProvider } from "../ai/webhook-signature.ts";
import { verifyWebhookSignature } from "../ai/webhook-signature.ts";
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

// Synthetic signing fixtures only. Exercise the generated module, including Phantom reads.
const body = '{"event":"created","name":"café"}';
const secret = "fixture-webhook-key";

function signedHeaders(
  provider: WebhookProvider,
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  if (provider === "github") {
    return new Headers({
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    });
  }
  if (provider === "stripe") {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return new Headers({ "stripe-signature": `t=${timestamp},v1=${signature}` });
  }
  const prefix = provider === "clerk" ? "svix" : "webhook";
  const signature = createHmac("sha256", secret)
    .update(`fixture-id.${timestamp}.${body}`)
    .digest("base64");
  return new Headers({
    [`${prefix}-id`]: "fixture-id",
    [`${prefix}-timestamp`]: timestamp,
    [`${prefix}-signature`]: `v1,${signature}`,
  });
}

for (const provider of ["stripe", "github", "clerk", "supabase"] as const) {
  describe(`generated ${provider} webhook`, () => {
    let harness: Harness;
    let handle: (request: Request) => Promise<Response>;
    const keyName = `${provider.toUpperCase()}_WEBHOOK_SECRET`;
    const storedSecret =
      provider === "clerk" ? `whsec_${Buffer.from(secret).toString("base64")}` : secret;

    beforeEach(async () => {
      harness = setupFakePhantom({ [keyName]: storedSecret }, { legacyHeadlessReveal: true });
      const recipe: Recipe = {
        id: "signed-webhook",
        query: "webhook",
        createdAt: "2026-04-18T00:00:00.000Z",
        providers: [{ name: provider }],
      };
      const result = await wirePhantomForRecipe(recipe, { cwd: harness.dir });
      const modules = join(harness.dir, "node_modules/@ashlr");
      mkdirSync(modules, { recursive: true });
      symlinkSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
        join(modules, "stack-core"),
      );
      const generated = await import(result.webhooks[0]);
      handle = generated[`handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`];
    });
    afterEach(() => harness.cleanup());

    function request(payload = body, headers = signedHeaders(provider)) {
      return new Request("https://example.test/webhook", {
        method: "POST",
        body: payload,
        headers,
      });
    }

    it("accepts a valid signature using the existing Phantom key path", async () => {
      expect((await handle(request())).status).toBe(200);
      expect(harness.callsTo("reveal")).toEqual([{ cmd: "reveal", args: [keyName] }]);
      expect(harness.callsTo("add")).toEqual([]);
    });
    it("rejects a tampered body with the original signature", async () => {
      expect((await handle(request(body.replace("created", "deleted")))).status).toBe(401);
    });
    it("rejects missing and malformed signatures", async () => {
      expect((await handle(request(body, new Headers()))).status).toBe(401);
      const headers = signedHeaders(provider);
      const name =
        provider === "github"
          ? "x-hub-signature-256"
          : provider === "stripe"
            ? "stripe-signature"
            : provider === "clerk"
              ? "svix-signature"
              : "webhook-signature";
      headers.set(name, "invalid");
      expect((await handle(request(body, headers))).status).toBe(401);
    });
    it("rejects a signature made with a different key", async () => {
      writeFileSync(harness.vaultPath, JSON.stringify({ [keyName]: "wrong-key" }));
      expect((await handle(request())).status).toBe(401);
    });
    it("fails closed without leaking Phantom errors when the vault is unavailable", async () => {
      writeFileSync(harness.vaultPath, "not json");
      const response = await handle(request());
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("Webhook key unavailable");
    });
    it("fails closed when Phantom refuses headless reveal", async () => {
      const binary = join(harness.dir, "phantom");
      writeFileSync(
        binary,
        readFileSync(binary, "utf-8").replace(
          "LEGACY_HEADLESS_REVEAL=1",
          "LEGACY_HEADLESS_REVEAL=0",
        ),
      );
      expect((await handle(request())).status).toBe(503);
    });
    it("fails closed when the signing key is empty", async () => {
      writeFileSync(harness.vaultPath, JSON.stringify({ [keyName]: "" }));
      expect((await handle(request())).status).toBe(503);
    });
    if (provider !== "github") {
      it("rejects correctly signed stale and future deliveries", async () => {
        for (const offset of [-600, 600]) {
          const timestamp = String(Math.floor(Date.now() / 1000) + offset);
          expect((await handle(request(body, signedHeaders(provider, timestamp)))).status).toBe(
            401,
          );
        }
      });
      it("accepts a matching rotated signature alongside a nonmatching signature", async () => {
        const headers = signedHeaders(provider);
        const name =
          provider === "stripe"
            ? "stripe-signature"
            : provider === "clerk"
              ? "svix-signature"
              : "webhook-signature";
        headers.set(
          name,
          provider === "stripe"
            ? `${headers.get(name)},v1=${"0".repeat(64)}`
            : `v1,${Buffer.alloc(32).toString("base64")} ${headers.get(name)}`,
        );
        expect((await handle(request(body, headers))).status).toBe(200);
      });
    }
  });
}

it("verifies the published GitHub test vector", () => {
  const headers = new Headers({
    "x-hub-signature-256":
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
  });
  expect(
    verifyWebhookSignature(
      "github",
      headers,
      new TextEncoder().encode("Hello, World!"),
      "It's a Secret to Everybody",
    ),
  ).toBe(true);
});

it("accepts Supabase base64 keys and rejects tampered signed metadata", () => {
  const headers = signedHeaders("supabase");
  const key = `whsec_${Buffer.from(secret).toString("base64")}`;
  const bytes = new TextEncoder().encode(body);
  expect(verifyWebhookSignature("supabase", headers, bytes, key)).toBe(true);
  headers.set("webhook-id", "tampered-id");
  expect(verifyWebhookSignature("supabase", headers, bytes, key)).toBe(false);
});

it("rejects malformed timestamps and signature suffixes", () => {
  const bytes = new TextEncoder().encode(body);
  const stripe = signedHeaders("stripe");
  for (const timestamp of ["NaN", "Infinity", "", "1.5", "99999999999999999"]) {
    stripe.set("stripe-signature", `t=${timestamp},v1=${"0".repeat(64)}`);
    expect(verifyWebhookSignature("stripe", stripe, bytes, secret)).toBe(false);
  }
  const github = signedHeaders("github");
  github.set("x-hub-signature-256", `${github.get("x-hub-signature-256")}junk`);
  expect(verifyWebhookSignature("github", github, bytes, secret)).toBe(false);
});
