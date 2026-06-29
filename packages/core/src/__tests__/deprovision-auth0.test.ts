import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import auth0 from "../providers/auth0.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("auth0 deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  // auth.token is the Auth0 domain for this provider
  const auth = { token: "myapp.us.auth0.com", identity: { issuer: "https://myapp.us.auth0.com/" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — tenant reachable, account attachment, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("myapp.us.auth0.com/.well-known/openid-configuration")) {
        return new Response(JSON.stringify({ issuer: "https://myapp.us.auth0.com/" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(auth0.deprovision!(ctx, auth, "default")).resolves.toBeUndefined();
  });

  test("non-ok response logs warn but does not throw (tenant may be gone)", async () => {
    const logs: string[] = [];
    const warnCtx: ProviderContext = {
      ...ctx,
      log: (e) => { if (e.level === "warn") logs.push(e.msg); },
    };

    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;

    await expect(auth0.deprovision!(warnCtx, auth, "default")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("myapp.us.auth0.com"))).toBe(true);
  });

  test("network error logs warn but does not throw", async () => {
    const logs: string[] = [];
    const warnCtx: ProviderContext = {
      ...ctx,
      log: (e) => { if (e.level === "warn") logs.push(e.msg); },
    };

    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;

    await expect(auth0.deprovision!(warnCtx, auth, "default")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("myapp.us.auth0.com"))).toBe(true);
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(auth0.deprovision!(abortCtx, auth, "default")).rejects.toMatchObject({
      code: "AUTH0_DEPROVISION_ABORTED",
    });
  });
});
