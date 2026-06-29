import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StackError } from "../errors.ts";
import type { ProviderContext } from "../providers/_base.ts";
import github from "../providers/github.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("github deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = { token: "ghp_valid_token", identity: { login: "octocat" } };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("plain user login (no owner/repo) — validates token and returns without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("api.github.com/user")) {
        return new Response(JSON.stringify({ login: "octocat", id: 1 }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(github.deprovision!(ctx, auth, "octocat")).resolves.toBeUndefined();
  });

  test("owner/repo — 404 on check is idempotent (already deleted)", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("api.github.com/repos/")) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    await expect(github.deprovision!(ctx, auth, "octocat/my-repo")).resolves.toBeUndefined();
  });

  test("owner/repo — successfully deletes repo (204)", async () => {
    let checkCalled = false;
    let deleteCalled = false;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("api.github.com/repos/octocat/my-repo")) {
        if (method === "DELETE") {
          deleteCalled = true;
          return new Response("", { status: 204 });
        }
        checkCalled = true;
        return new Response(JSON.stringify({ full_name: "octocat/my-repo" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${method} ${u}`);
    }) as typeof fetch;

    await expect(github.deprovision!(ctx, auth, "octocat/my-repo")).resolves.toBeUndefined();
    expect(checkCalled).toBe(true);
    expect(deleteCalled).toBe(true);
  });

  test("owner/repo — 403 on check throws GITHUB_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    await expect(github.deprovision!(ctx, auth, "octocat/my-repo")).rejects.toMatchObject({
      code: "GITHUB_DEPROVISION_FORBIDDEN",
    });
  });

  test("owner/repo — 403 on delete throws GITHUB_DEPROVISION_FORBIDDEN", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") return new Response("forbidden", { status: 403 });
      return new Response(JSON.stringify({ full_name: "octocat/my-repo" }), { status: 200 });
    }) as typeof fetch;

    await expect(github.deprovision!(ctx, auth, "octocat/my-repo")).rejects.toMatchObject({
      code: "GITHUB_DEPROVISION_FORBIDDEN",
    });
  });

  test("plain login — invalid token throws GITHUB_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 401 })) as typeof fetch;

    await expect(github.deprovision!(ctx, auth, "octocat")).rejects.toMatchObject({
      code: "GITHUB_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(github.deprovision!(abortCtx, auth, "octocat/my-repo")).rejects.toMatchObject({
      code: "GITHUB_DEPROVISION_ABORTED",
    });
  });
});
