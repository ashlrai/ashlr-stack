import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import cloudflare from "../providers/cloudflare.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("cloudflare deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "cf_valid_token", identity: { token_id: "tok_1" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — account is accessible, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/accounts/acct_123")) {
        return new Response(JSON.stringify({ result: { id: "acct_123", name: "My Account" } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(cloudflare.deprovision!(ctx, auth, "acct_123")).resolves.toBeUndefined();
  });

  test("404 on account check is idempotent (account gone or access revoked)", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;

    await expect(cloudflare.deprovision!(ctx, auth, "acct_123")).resolves.toBeUndefined();
  });

  test("403 on account check throws CLOUDFLARE_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(cloudflare.deprovision!(ctx, auth, "acct_123")).rejects.toMatchObject({
      code: "CLOUDFLARE_DEPROVISION_FORBIDDEN",
    });
  });

  test("unexpected error response throws CLOUDFLARE_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "internal error" }] }), {
        status: 500,
      })) as typeof fetch;

    await expect(cloudflare.deprovision!(ctx, auth, "acct_123")).rejects.toMatchObject({
      code: "CLOUDFLARE_DEPROVISION_FAILED",
    });
  });

  test("network error throws CLOUDFLARE_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;

    await expect(cloudflare.deprovision!(ctx, auth, "acct_123")).rejects.toMatchObject({
      code: "CLOUDFLARE_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(cloudflare.deprovision!(abortCtx, auth, "acct_123")).rejects.toMatchObject({
      code: "CLOUDFLARE_DEPROVISION_ABORTED",
    });
  });
});
