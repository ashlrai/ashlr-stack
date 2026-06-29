import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import sentry from "../providers/sentry.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("sentry deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "sntrys_valid_token", identity: { id: "user1" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("invalid resourceId format throws SENTRY_DEPROVISION_FAILED", async () => {
    await expect(sentry.deprovision!(ctx, auth, "bad-resource-id")).rejects.toMatchObject({
      code: "SENTRY_DEPROVISION_FAILED",
    });
  });

  test("404 on check is idempotent (project already deleted)", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;

    await expect(sentry.deprovision!(ctx, auth, "my-org/my-project")).resolves.toBeUndefined();
  });

  test("successfully deletes project (200 check + 204 delete)", async () => {
    let deleted = false;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/projects/my-org/my-project/")) {
        if (method === "DELETE") {
          deleted = true;
          return new Response("", { status: 204 });
        }
        return new Response(JSON.stringify({ slug: "my-project", id: "123" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${method} ${u}`);
    }) as typeof fetch;

    await expect(sentry.deprovision!(ctx, auth, "my-org/my-project")).resolves.toBeUndefined();
    expect(deleted).toBe(true);
  });

  test("404 on delete is idempotent", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") return new Response("", { status: 404 });
      return new Response(JSON.stringify({ slug: "my-project" }), { status: 200 });
    }) as typeof fetch;

    await expect(sentry.deprovision!(ctx, auth, "my-org/my-project")).resolves.toBeUndefined();
  });

  test("403 on check throws SENTRY_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(sentry.deprovision!(ctx, auth, "my-org/my-project")).rejects.toMatchObject({
      code: "SENTRY_DEPROVISION_FORBIDDEN",
    });
  });

  test("403 on delete throws SENTRY_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") return new Response("forbidden", { status: 403 });
      return new Response(JSON.stringify({ slug: "my-project" }), { status: 200 });
    }) as typeof fetch;

    await expect(sentry.deprovision!(ctx, auth, "my-org/my-project")).rejects.toMatchObject({
      code: "SENTRY_DEPROVISION_FORBIDDEN",
    });
  });

  test("unexpected error on delete throws SENTRY_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") return new Response("server error", { status: 500 });
      return new Response(JSON.stringify({ slug: "my-project" }), { status: 200 });
    }) as typeof fetch;

    await expect(sentry.deprovision!(ctx, auth, "my-org/my-project")).rejects.toMatchObject({
      code: "SENTRY_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(sentry.deprovision!(abortCtx, auth, "my-org/my-project")).rejects.toMatchObject({
      code: "SENTRY_DEPROVISION_ABORTED",
    });
  });
});
