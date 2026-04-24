import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import turso from "../providers/turso.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("turso provider (mocked fetch)", () => {
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

  test("provision creates a database and returns org/dbname resource id", async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/organizations") && method === "GET") {
        return new Response(JSON.stringify([{ slug: "my-org", name: "My Org" }]), { status: 200 });
      }
      if (u.endsWith("/organizations/my-org/databases") && method === "POST") {
        return new Response(
          JSON.stringify({
            database: { Name: "stack-xyz", Hostname: "stack-xyz-my-org.turso.io" },
          }),
          { status: 201 },
        );
      }
      throw new Error(`unexpected ${method} ${u}`);
    }) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "turso-fake-platform-token", identity: {} };
    const resource = await turso.provision(ctx, auth, {});
    expect(resource.id).toBe("my-org/stack-xyz");
    expect((resource.meta as { hostname?: string })?.hostname).toBe("stack-xyz-my-org.turso.io");
  });

  test("materialize mints an auth token and writes TURSO_DATABASE_URL", async () => {
    const jwt = "eyJfake_jwt";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/auth/tokens") && method === "POST") {
        return new Response(JSON.stringify({ jwt }), { status: 200 });
      }
      throw new Error(`unexpected ${method} ${u}`);
    }) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const resource = {
      id: "my-org/stack-xyz",
      displayName: "stack-xyz",
      meta: { hostname: "stack-xyz-my-org.turso.io" },
    };
    const auth = { token: "turso-platform-token", identity: {} };
    const materialized = await turso.materialize(ctx, resource, auth);
    expect(materialized.secrets.TURSO_DATABASE_URL).toBe("libsql://stack-xyz-my-org.turso.io");
    expect(materialized.secrets.TURSO_AUTH_TOKEN).toBe(jwt);
    expect(materialized.secrets.TURSO_PLATFORM_TOKEN).toBe("turso-platform-token");
  });
});
