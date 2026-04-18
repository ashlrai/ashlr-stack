import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import github from "../providers/github.ts";
import type { ProviderContext } from "../providers/_base.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

describe("github provider (mocked fetch)", () => {
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

  test("materialize writes GITHUB_TOKEN + wires the official MCP server", async () => {
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "ghp_fake", identity: { login: "mason" } };
    const resource = { id: "mason", displayName: "@mason" };
    const materialized = await github.materialize(ctx, resource, auth);
    expect(materialized.secrets.GITHUB_TOKEN).toBe("ghp_fake");
    expect(materialized.mcp?.name).toBe("github");
    expect(materialized.mcp?.command).toBe("npx");
  });

  test("healthcheck accepts a cached token that validates via /user", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_cached");

    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/user")) {
        return new Response(JSON.stringify({ login: "mason", id: 42 }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await github.healthcheck!(ctx, {
      provider: "github",
      secrets: ["GITHUB_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("ok");
  });

  test("healthcheck reports error when the token is rejected", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_bad");

    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await github.healthcheck!(ctx, {
      provider: "github",
      secrets: ["GITHUB_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });
});
