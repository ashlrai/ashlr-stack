import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import stripe from "../providers/stripe.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("stripe deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "sk_test_valid_key", identity: { id: "acct_123" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("plain account id (not we_…) — no-op, resolves without error", async () => {
    // No fetch should be called for non-webhook resource ids.
    globalThis.fetch = (async () => {
      throw new Error("unexpected fetch for non-webhook resource");
    }) as typeof fetch;

    await expect(stripe.deprovision!(ctx, auth, "acct_123")).resolves.toBeUndefined();
  });

  test("webhook endpoint — 404 on check is idempotent (already deleted)", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/v1/webhook_endpoints/we_abc")) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(stripe.deprovision!(ctx, auth, "we_abc")).resolves.toBeUndefined();
  });

  test("webhook endpoint — successfully deletes (200 check + 200 delete)", async () => {
    let deleted = false;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/v1/webhook_endpoints/we_abc")) {
        if (method === "DELETE") {
          deleted = true;
          return new Response(JSON.stringify({ id: "we_abc", deleted: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: "we_abc", url: "https://example.com" }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${method} ${u}`);
    }) as typeof fetch;

    await expect(stripe.deprovision!(ctx, auth, "we_abc")).resolves.toBeUndefined();
    expect(deleted).toBe(true);
  });

  test("webhook endpoint — 404 on delete is idempotent", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ id: "we_abc" }), { status: 200 });
    }) as typeof fetch;

    await expect(stripe.deprovision!(ctx, auth, "we_abc")).resolves.toBeUndefined();
  });

  test("webhook endpoint — 403 check throws STRIPE_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(stripe.deprovision!(ctx, auth, "we_abc")).rejects.toMatchObject({
      code: "STRIPE_DEPROVISION_FORBIDDEN",
    });
  });

  test("webhook endpoint — delete failure throws STRIPE_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        return new Response(
          JSON.stringify({ error: { message: "cannot delete active endpoint" } }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ id: "we_abc" }), { status: 200 });
    }) as typeof fetch;

    await expect(stripe.deprovision!(ctx, auth, "we_abc")).rejects.toMatchObject({
      code: "STRIPE_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(stripe.deprovision!(abortCtx, auth, "we_abc")).rejects.toMatchObject({
      code: "STRIPE_DEPROVISION_ABORTED",
    });
  });
});
