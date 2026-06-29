import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import fly from "../providers/fly.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("fly deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "fly_valid_token", identity: { apps: "3" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — token is valid, account attachment, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("api.machines.dev/v1/apps")) {
        return new Response(JSON.stringify({ apps: [{ name: "my-app" }] }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(fly.deprovision!(ctx, auth, "default")).resolves.toBeUndefined();
  });

  test("401 response throws FLY_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;

    await expect(fly.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "FLY_DEPROVISION_FORBIDDEN",
    });
  });

  test("403 response throws FLY_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(fly.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "FLY_DEPROVISION_FORBIDDEN",
    });
  });

  test("non-ok response throws FLY_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;

    await expect(fly.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "FLY_DEPROVISION_FAILED",
    });
  });

  test("network error throws FLY_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;

    await expect(fly.deprovision!(ctx, auth, "default")).rejects.toMatchObject({
      code: "FLY_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(fly.deprovision!(abortCtx, auth, "default")).rejects.toMatchObject({
      code: "FLY_DEPROVISION_ABORTED",
    });
  });
});
