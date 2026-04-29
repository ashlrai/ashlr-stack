import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import stripe, {
  DEFAULT_WEBHOOK_EVENTS,
  _createWebhookEndpoint,
  _verifyKey,
} from "../providers/stripe.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * Unit tests for the Stripe webhook provisioning flow.
 *
 * All HTTP is mocked — these tests never reach api.stripe.com.
 *
 * Scenarios:
 *   (a) Successful webhook creation — keys land in vault, secrets returned correctly.
 *   (b) Webhook creation with custom events list.
 *   (c) Default events list is used when --events is omitted.
 *   (d) Error path when sk_ is not in vault and --secret-key-from-vault is set.
 *   (e) Stripe API error propagates as StackError with STRIPE_WEBHOOK_CREATE_FAILED code.
 *   (f) Plain sk_… flow (no webhook) still works after the refactor.
 */

const FAKE_SK = "sk_test_fake_secret_key";
const FAKE_WEBHOOK_ID = "we_1234567890abcdef";
const FAKE_WHSEC = "whsec_abcdefghijklmnopqrstuvwxyz0123456789";
const WEBHOOK_URL = "https://example.com/webhooks/stripe";

function makeCtx(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return { cwd: process.cwd(), interactive: false, log: () => {}, ...overrides };
}

function mockFetchOk(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function stripeAccountOk(): Response {
  return new Response(JSON.stringify({ id: "acct_fake", type: "standard" }), { status: 200 });
}

function webhookCreateOk(endpointId: string, whsec: string, url: string): Response {
  return new Response(
    JSON.stringify({ id: endpointId, secret: whsec, url, object: "webhook_endpoint" }),
    { status: 201 },
  );
}

describe("stripe provider — webhook provisioning", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  // ── (a) Successful webhook creation ──────────────────────────────────────

  test("(a) provision creates webhook, materialize stores all three secrets", async () => {
    const captured: { url: string; method: string; body: string }[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      captured.push({ url, method, body: String(init?.body ?? "") });

      if (url.includes("/v1/account")) return stripeAccountOk();
      if (url.includes("/v1/webhook_endpoints") && method === "POST") {
        return webhookCreateOk(FAKE_WEBHOOK_ID, FAKE_WHSEC, WEBHOOK_URL);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    }) as unknown as typeof fetch;

    const ctx = makeCtx();
    const auth = { token: FAKE_SK, identity: { id: "acct_fake", type: "standard" } };

    const resource = await stripe.provision(ctx, auth, {
      hints: { webhookEndpoint: WEBHOOK_URL },
    });

    expect(resource.id).toBe(FAKE_WEBHOOK_ID);
    expect(resource.displayName).toBe(`Stripe webhook (${FAKE_WEBHOOK_ID})`);
    expect((resource.meta as Record<string, string>).webhookSecret).toBe(FAKE_WHSEC);
    expect((resource.meta as Record<string, string>).webhookEndpointId).toBe(FAKE_WEBHOOK_ID);

    const materialized = await stripe.materialize(ctx, resource, auth);

    // All three env names must be in the returned secrets map.
    expect(materialized.secrets.STRIPE_SECRET_KEY).toBe(FAKE_SK);
    expect(materialized.secrets.STRIPE_WEBHOOK_SECRET).toBe(FAKE_WHSEC);
    expect(materialized.secrets.STRIPE_WEBHOOK_ENDPOINT_ID).toBe(FAKE_WEBHOOK_ID);

    // Vault must contain all three.
    const vault = await readVault(h.dir);
    expect(vault.STRIPE_SECRET_KEY).toBe(FAKE_SK);
    expect(vault.STRIPE_WEBHOOK_SECRET).toBe(FAKE_WHSEC);
    expect(vault.STRIPE_WEBHOOK_ENDPOINT_ID).toBe(FAKE_WEBHOOK_ID);

    // The POST to /v1/webhook_endpoints must use form-encoded body.
    const webhookCall = captured.find(
      (c) => c.url.includes("/v1/webhook_endpoints") && c.method === "POST",
    );
    expect(webhookCall).toBeTruthy();
    expect(webhookCall!.body).toContain(encodeURIComponent(WEBHOOK_URL));
  });

  // ── (b) Custom events list is forwarded to Stripe ────────────────────────

  test("(b) custom --events are sent in the POST body", async () => {
    const customEvents = ["payment_intent.succeeded", "charge.failed"];
    let capturedBody = "";

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/v1/webhook_endpoints") && method === "POST") {
        capturedBody = String(init?.body ?? "");
        return webhookCreateOk(FAKE_WEBHOOK_ID, FAKE_WHSEC, WEBHOOK_URL);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    }) as unknown as typeof fetch;

    const ctx = makeCtx();
    const auth = { token: FAKE_SK, identity: {} };

    await stripe.provision(ctx, auth, {
      hints: { webhookEndpoint: WEBHOOK_URL, events: customEvents.join(",") },
    });

    for (const ev of customEvents) {
      expect(capturedBody).toContain(encodeURIComponent(ev));
    }
    // Default events must NOT appear when a custom list is provided.
    for (const defaultEv of DEFAULT_WEBHOOK_EVENTS) {
      expect(capturedBody).not.toContain(encodeURIComponent(defaultEv));
    }
  });

  // ── (c) Default events list ───────────────────────────────────────────────

  test("(c) default subscription-lifecycle events are used when --events is omitted", async () => {
    let capturedBody = "";

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/v1/webhook_endpoints") && method === "POST") {
        capturedBody = String(init?.body ?? "");
        return webhookCreateOk(FAKE_WEBHOOK_ID, FAKE_WHSEC, WEBHOOK_URL);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    }) as unknown as typeof fetch;

    const ctx = makeCtx();
    const auth = { token: FAKE_SK, identity: {} };

    await stripe.provision(ctx, auth, { hints: { webhookEndpoint: WEBHOOK_URL } });

    expect(DEFAULT_WEBHOOK_EVENTS.length).toBeGreaterThan(0);
    for (const ev of DEFAULT_WEBHOOK_EVENTS) {
      expect(capturedBody).toContain(encodeURIComponent(ev));
    }
  });

  // ── (d) --secret-key-from-vault fails when vault is empty ────────────────

  test("(d) login throws STRIPE_AUTH_REQUIRED when vault is empty and --secret-key-from-vault", async () => {
    // Vault is empty (setupFakePhantom initialises with {}).
    const ctx = makeCtx({ hints: { secretKeyFromVault: true } });

    await expect(stripe.login(ctx)).rejects.toMatchObject({
      code: "STRIPE_AUTH_REQUIRED",
    });
  });

  // ── (e) Stripe API error propagates correctly ─────────────────────────────

  test("(e) Stripe 400 during webhook creation throws STRIPE_WEBHOOK_CREATE_FAILED", async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/v1/webhook_endpoints") && method === "POST") {
        return new Response(
          JSON.stringify({ error: { message: "Invalid URL" } }),
          { status: 400 },
        );
      }
      throw new Error(`Unexpected ${method} ${url}`);
    }) as unknown as typeof fetch;

    const ctx = makeCtx();
    const auth = { token: FAKE_SK, identity: {} };

    await expect(
      stripe.provision(ctx, auth, { hints: { webhookEndpoint: "not-a-url" } }),
    ).rejects.toMatchObject({ code: "STRIPE_WEBHOOK_CREATE_FAILED" });
  });

  // ── (f) Plain sk_… flow unchanged ────────────────────────────────────────

  test("(f) provision without webhookEndpoint hint behaves like makeApiKeyProvider", async () => {
    // No HTTP call is made in the plain flow.
    globalThis.fetch = (async () => {
      throw new Error("fetch must not be called in the plain sk_ flow");
    }) as unknown as typeof fetch;

    const ctx = makeCtx();
    const auth = { token: FAKE_SK, identity: { id: "acct_fake", type: "standard" } };

    const resource = await stripe.provision(ctx, auth, {});
    expect(resource.id).toBe("acct_fake");

    const materialized = await stripe.materialize(ctx, resource, auth);
    expect(materialized.secrets.STRIPE_SECRET_KEY).toBe(FAKE_SK);
    // Webhook secrets must NOT appear when no webhook was created.
    expect(materialized.secrets.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(materialized.secrets.STRIPE_WEBHOOK_ENDPOINT_ID).toBeUndefined();

    const vault = await readVault(h.dir);
    expect(vault.STRIPE_SECRET_KEY).toBe(FAKE_SK);
    expect(vault.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });
});

describe("stripe provider — _createWebhookEndpoint (unit)", () => {
  let realFetch: typeof fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("returns parsed endpoint response on 201", async () => {
    globalThis.fetch = mockFetchOk(
      { id: FAKE_WEBHOOK_ID, secret: FAKE_WHSEC, url: WEBHOOK_URL },
      201,
    );
    const result = await _createWebhookEndpoint(FAKE_SK, WEBHOOK_URL, DEFAULT_WEBHOOK_EVENTS);
    expect(result.id).toBe(FAKE_WEBHOOK_ID);
    expect(result.secret).toBe(FAKE_WHSEC);
    expect(result.url).toBe(WEBHOOK_URL);
  });

  test("throws on non-2xx with Stripe error detail", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: "URL must be HTTPS" } }),
        { status: 400 },
      )) as unknown as typeof fetch;

    await expect(
      _createWebhookEndpoint(FAKE_SK, "http://insecure.example.com/hook", ["payment_intent.succeeded"]),
    ).rejects.toMatchObject({ code: "STRIPE_WEBHOOK_CREATE_FAILED" });
  });
});
