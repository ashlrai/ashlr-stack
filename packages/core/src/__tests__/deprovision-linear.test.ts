import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import linear from "../providers/linear.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("linear deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "lin_api_valid_key", identity: { id: "user_abc", name: "Test User", email: "test@example.com" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — token valid, account attachment, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("api.linear.app/graphql")) {
        return new Response(
          JSON.stringify({ data: { viewer: { id: "user_abc" } } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(linear.deprovision!(ctx, auth, "user_abc")).resolves.toBeUndefined();
  });

  test("401 response throws LINEAR_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;

    await expect(linear.deprovision!(ctx, auth, "user_abc")).rejects.toMatchObject({
      code: "LINEAR_DEPROVISION_FORBIDDEN",
    });
  });

  test("403 response throws LINEAR_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(linear.deprovision!(ctx, auth, "user_abc")).rejects.toMatchObject({
      code: "LINEAR_DEPROVISION_FORBIDDEN",
    });
  });

  test("non-ok response throws LINEAR_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;

    await expect(linear.deprovision!(ctx, auth, "user_abc")).rejects.toMatchObject({
      code: "LINEAR_DEPROVISION_FAILED",
    });
  });

  test("network error throws LINEAR_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;

    await expect(linear.deprovision!(ctx, auth, "user_abc")).rejects.toMatchObject({
      code: "LINEAR_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(linear.deprovision!(abortCtx, auth, "user_abc")).rejects.toMatchObject({
      code: "LINEAR_DEPROVISION_ABORTED",
    });
  });
});
