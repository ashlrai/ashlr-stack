import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import upstash from "../providers/upstash.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("upstash deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "user@example.com:upstash_mgmt_token", identity: { databases: "2" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — credentials valid, account attachment, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("api.upstash.com/v2/redis/databases")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(upstash.deprovision!(ctx, auth, "default")).resolves.toBeUndefined();
  });

  test("401 response throws UPSTASH_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;

    await expect(upstash.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "UPSTASH_DEPROVISION_FORBIDDEN",
    });
  });

  test("403 response throws UPSTASH_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(upstash.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "UPSTASH_DEPROVISION_FORBIDDEN",
    });
  });

  test("non-ok response throws UPSTASH_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;

    await expect(upstash.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "UPSTASH_DEPROVISION_FAILED",
    });
  });

  test("network error throws UPSTASH_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;

    await expect(upstash.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "UPSTASH_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(upstash.deprovision!(abortCtx, auth, "default")).rejects.toMatchObject({
      code: "UPSTASH_DEPROVISION_ABORTED",
    });
  });
});
