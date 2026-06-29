import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import supabase from "../providers/supabase.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("supabase deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "sbp_valid_token", identity: { id: "u1" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — DELETE returns 200, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/v1/projects/proj_abc") && method === "DELETE") {
        return new Response("", { status: 200 });
      }
      throw new Error(`unexpected fetch ${method} ${u}`);
    }) as typeof fetch;

    await expect(supabase.deprovision!(ctx, auth, "proj_abc")).resolves.toBeUndefined();
  });

  test("404 on DELETE is idempotent (project already deleted)", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;

    await expect(supabase.deprovision!(ctx, auth, "proj_abc")).resolves.toBeUndefined();
  });

  test("non-ok response logs warn but does not throw", async () => {
    const logs: string[] = [];
    const warnCtx: ProviderContext = {
      ...ctx,
      log: (e) => { if (e.level === "warn") logs.push(e.msg); },
    };

    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;

    await expect(supabase.deprovision!(warnCtx, auth, "proj_abc")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("proj_abc"))).toBe(true);
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

    await expect(supabase.deprovision!(warnCtx, auth, "proj_abc")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("proj_abc"))).toBe(true);
  });
});
