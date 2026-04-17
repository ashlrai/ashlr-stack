import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import supabase from "../providers/supabase.ts";
import type { ProviderContext } from "../providers/_base.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * Supabase provider — exercised end-to-end with fetch mocked. Validates that
 * we send the right payloads to the Supabase Management API, parse the
 * responses correctly, and route secrets into the fake vault.
 */
describe("supabase provider (mocked fetch)", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom({
      STACK_SUPABASE_ACCESS_TOKEN: "sbp_cached_valid_token",
    });
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("reuses a cached token when the identity call succeeds", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/v1/profile")) {
        return new Response(JSON.stringify({ id: "u1", email: "mason@example.com" }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = await supabase.login(ctx);
    expect(auth.token).toBe("sbp_cached_valid_token");
    expect(auth.identity?.email).toBe("mason@example.com");
  });

  test("provision → materialize writes URL + anon + service_role", async () => {
    const createdProject = {
      id: "abcdefghij",
      name: "stack-xyz",
      region: "us-east-1",
      organization_id: "org_1",
    };

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/v1/organizations") && method === "GET") {
        return new Response(JSON.stringify([{ id: "org_1", name: "Default" }]), { status: 200 });
      }
      if (u.endsWith("/v1/projects") && method === "POST") {
        return new Response(JSON.stringify(createdProject), { status: 201 });
      }
      if (u.endsWith(`/v1/projects/${createdProject.id}/api-keys`)) {
        return new Response(
          JSON.stringify([
            { name: "anon", api_key: "anon-key" },
            { name: "service_role", api_key: "service-key" },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${method} ${u}`);
    }) as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "sbp_token", identity: {} };
    const resource = await supabase.provision(ctx, auth, {});
    expect(resource.id).toBe(createdProject.id);
    expect(resource.region).toBe("us-east-1");

    const materialized = await supabase.materialize(ctx, resource, auth);
    expect(materialized.secrets.SUPABASE_URL).toBe(`https://${createdProject.id}.supabase.co`);
    expect(materialized.secrets.SUPABASE_ANON_KEY).toBe("anon-key");
    expect(materialized.secrets.SUPABASE_SERVICE_ROLE_KEY).toBe("service-key");
    expect(materialized.mcp?.name).toBe("supabase");

    // Provision also stashes the auto-generated DB password in Phantom.
    const vault = await readVault(h.dir);
    const dbPassKey = Object.keys(vault).find((k) => k.startsWith("SUPABASE_DB_PASSWORD_"));
    expect(dbPassKey).toBeDefined();
  });

  test("bubbles up a useful error when the Management API rejects create", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/v1/organizations")) {
        return new Response(JSON.stringify([{ id: "o", name: "x" }]), { status: 200 });
      }
      if (u.endsWith("/v1/projects")) {
        return new Response("rate limited", { status: 429 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    await expect(supabase.provision(ctx, { token: "t" }, {})).rejects.toThrow(
      /SUPABASE_CREATE_FAILED|project creation failed/,
    );
  });
});
