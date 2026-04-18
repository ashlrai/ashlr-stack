import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import neon from "../providers/neon.ts";
import type { ProviderContext } from "../providers/_base.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

describe("neon provider (mocked fetch)", () => {
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

  test("provision POSTs /projects and materialize fetches a connection URI", async () => {
    const projectId = "proj_abc123";
    const connectionUri = "postgresql://user:pw@ep-xx.us-east-2.aws.neon.tech/neondb";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";

      if (u.endsWith("/projects") && method === "POST") {
        return new Response(
          JSON.stringify({
            project: { id: projectId, name: "stack-xyz", region_id: "aws-us-east-2" },
            connection_uris: [{ connection_uri: connectionUri }],
          }),
          { status: 201 },
        );
      }
      if (u.endsWith(`/projects/${projectId}/connection_uri`)) {
        return new Response(JSON.stringify({ uri: connectionUri }), { status: 200 });
      }
      throw new Error(`unexpected ${method} ${u}`);
    }) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "neon_fake", identity: {} };

    const resource = await neon.provision(ctx, auth, {});
    expect(resource.id).toBe(projectId);
    expect(resource.region).toBe("aws-us-east-2");

    const materialized = await neon.materialize(ctx, resource, auth);
    expect(materialized.secrets.NEON_API_KEY).toBe("neon_fake");
    expect(materialized.secrets.DATABASE_URL).toBe(connectionUri);

    // Provision stores a project-scoped copy so other providers can't stomp it.
    const vault = await readVault(h.dir);
    expect(vault[`NEON_DATABASE_URL_${projectId}`]).toBe(connectionUri);
  });

  test("healthcheck returns error when the project 404s", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon_cached");

    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes("/projects/")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await neon.healthcheck!(ctx, {
      provider: "neon",
      resource_id: "missing_proj",
      secrets: ["NEON_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });
});
