import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import railway from "../providers/railway.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("railway deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "railway_valid_token", identity: { id: "user1" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — token is valid, account attachment, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("backboard.railway.app/graphql/v2")) {
        return new Response(JSON.stringify({ data: { me: { id: "user1", email: "u@test.com" } } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(railway.deprovision!(ctx, auth, "user1")).resolves.toBeUndefined();
  });

  test("401 response throws RAILWAY_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;

    await expect(railway.deprovision!(ctx, auth, "user1")).rejects.toMatchObject({
      code: "RAILWAY_DEPROVISION_FORBIDDEN",
    });
  });

  test("403 response throws RAILWAY_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(railway.deprovision!(ctx, auth, "user1")).rejects.toMatchObject({
      code: "RAILWAY_DEPROVISION_FORBIDDEN",
    });
  });

  test("non-ok response throws RAILWAY_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;

    await expect(railway.deprovision!(ctx, auth, "user1")).rejects.toMatchObject({
      code: "RAILWAY_DEPROVISION_FAILED",
    });
  });

  test("network error throws RAILWAY_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;

    await expect(railway.deprovision!(ctx, auth, "user1")).rejects.toMatchObject({
      code: "RAILWAY_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(railway.deprovision!(abortCtx, auth, "user1")).rejects.toMatchObject({
      code: "RAILWAY_DEPROVISION_ABORTED",
    });
  });
});
