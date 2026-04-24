import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import openai from "../providers/openai.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

describe("openai provider (mocked fetch)", () => {
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

  test("materialize stores the key under OPENAI_API_KEY", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "sk-fake", identity: { models: "1" } };
    const resource = await openai.provision(ctx, auth, {});
    const materialized = await openai.materialize(ctx, resource, auth);

    expect(materialized.secrets.OPENAI_API_KEY).toBe("sk-fake");
    expect((await readVault(h.dir)).OPENAI_API_KEY).toBe("sk-fake");
  });

  test("healthcheck fails gracefully when the key is invalid", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    // Pre-seed an invalid key so healthcheck has something to verify.
    const { addSecret } = await import("../phantom.ts");
    await addSecret("OPENAI_API_KEY", "sk-bad");

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await openai.healthcheck!(ctx, {
      provider: "openai",
      secrets: ["OPENAI_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });
});
