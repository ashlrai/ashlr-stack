import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import cloudflare from "../providers/cloudflare.ts";
import type { ProviderContext } from "../providers/_base.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

describe("cloudflare provider (mocked fetch)", () => {
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

  test("provision → materialize writes CLOUDFLARE_API_TOKEN + ACCOUNT_ID", async () => {
    const token = "cf-fake-token";
    const accounts = [{ id: "acc-123", name: "Main" }];

    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/user/tokens/verify")) {
        return new Response(
          JSON.stringify({ result: { id: "tok1", status: "active" } }),
          { status: 200 },
        );
      }
      if (u.endsWith("/accounts")) {
        return new Response(JSON.stringify({ result: accounts }), { status: 200 });
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token, identity: { token_id: "tok1" } };
    const resource = await cloudflare.provision(ctx, auth, {});
    expect(resource.id).toBe("acc-123");

    const materialized = await cloudflare.materialize(ctx, resource, auth);
    expect(materialized.secrets.CLOUDFLARE_API_TOKEN).toBe(token);
    expect(materialized.secrets.CLOUDFLARE_ACCOUNT_ID).toBe("acc-123");
  });

  test("healthcheck pings /user/tokens/verify with the stored token", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLOUDFLARE_API_TOKEN", "cf-cached");

    let seenAuth = "";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Authorization) seenAuth = headers.Authorization;
      if (String(url).endsWith("/user/tokens/verify")) {
        return new Response(
          JSON.stringify({ result: { id: "tok1", status: "active" } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await cloudflare.healthcheck!(ctx, {
      provider: "cloudflare",
      secrets: ["CLOUDFLARE_API_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("ok");
    expect(seenAuth).toBe("Bearer cf-cached");
  });
});
