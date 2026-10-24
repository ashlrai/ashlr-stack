import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
import { addService } from "../pipeline.ts";
import type { ProviderContext } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import neon from "../providers/neon.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

const inertPreconnect: typeof fetch.preconnect = () => {
  throw new Error("Unexpected fetch preconnect in inert fixture.");
};

describe("neon provider (mocked fetch)", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    Reflect.deleteProperty(providers, "neonrollbackfixture");
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

    // Provision never writes the vault before pipeline rollback owns the resource.
    const vault = await readVault(h.dir);
    expect(vault[`NEON_DATABASE_URL_${projectId}`]).toBeUndefined();
    // DATABASE_URL is written once, by the pipeline from materialize(): Phantom
    // never replaces a stored name, so provision must not claim it first.
    expect(vault.DATABASE_URL).toBeUndefined();
  });

  test("fresh URI storage failure reaches rollback after the created resource is returned", async () => {
    const projectId = "proj_rollback";
    await writeConfig(emptyConfig(), h.dir);
    writeFileSync(h.vaultPath, JSON.stringify({ DATABASE_URL: "synthetic-existing" }));
    const before = readFileSync(`${h.dir}/.stack.toml`, "utf8");
    const calls = { created: 0, freshURI: 0, deleted: 0 };
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/projects") && method === "POST") {
        calls.created++;
        return new Response(
          JSON.stringify({
            project: { id: projectId, name: "inert", region_id: "fixture" },
            connection_uris: [{ connection_uri: "synthetic-provision-uri" }],
          }),
          { status: 201 },
        );
      }
      if (u.endsWith(`/projects/${projectId}/connection_uri`) && method === "GET") {
        calls.freshURI++;
        return new Response(JSON.stringify({ uri: "synthetic-fresh-uri" }), { status: 200 });
      }
      if (u.endsWith(`/projects/${projectId}`) && method === "DELETE") {
        calls.deleted++;
        return new Response("", { status: 200 });
      }
      throw new Error(`unexpected inert ${method} route`);
    }) as unknown as typeof fetch;
    providers.neonrollbackfixture = async () => ({
      ...neon,
      name: "neonrollbackfixture",
      async login() {
        return { token: "synthetic-key", identity: {} };
      },
    });
    await expect(
      addService({ providerName: "neonrollbackfixture", cwd: h.dir, interactive: false }),
    ).rejects.toMatchObject({ code: "ADD_SERVICE_ROLLED_BACK" });
    expect(calls).toEqual({ created: 1, freshURI: 1, deleted: 1 });
    expect(readFileSync(`${h.dir}/.stack.toml`, "utf8")).toBe(before);
    expect((await readConfig(h.dir)).services.neonrollbackfixture).toBeUndefined();
    const vault = await readVault(h.dir);
    expect(vault.DATABASE_URL).toBe("synthetic-existing");
    expect(vault[`NEON_DATABASE_URL_${projectId}`]).toBeUndefined();
    expect(h.callsTo("add").map((call) => call.args[0])).toEqual(["NEON_API_KEY", "DATABASE_URL"]);
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
  test.each([204, 404])(
    "DELETE %i is accepted exactly once without reading response bodies",
    async (status) => {
      let deletes = 0;
      globalThis.fetch = Object.assign(
        async (_url: unknown, init?: RequestInit) => {
          expect(init?.method).toBe("DELETE");
          deletes++;
          return new Response(null, { status });
        },
        { preconnect: inertPreconnect },
      );
      await expect(
        neon.deprovision!(
          { cwd: h.dir, interactive: false, log() {} },
          { token: "synthetic-key" },
          "inert-project",
        ),
      ).resolves.toBeUndefined();
      expect(deletes).toBe(1);
    },
  );

  test.each([403, 500])(
    "DELETE %i refuses unconfirmed teardown without exposing response contents",
    async (status) => {
      let deletes = 0;
      globalThis.fetch = Object.assign(
        async (_url: unknown, init?: RequestInit) => {
          expect(init?.method).toBe("DELETE");
          deletes++;
          return new Response("synthetic-private-response-must-not-surface", { status });
        },
        { preconnect: inertPreconnect },
      );
      const error = await neon.deprovision!(
        { cwd: h.dir, interactive: false, log() {} },
        { token: "synthetic-key" },
        "inert-project",
      ).catch((err: Error) => err);
      expect(error).toMatchObject({ code: "NEON_DELETE_FAILED" });
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toContain("synthetic-private-response-must-not-surface");
      expect(deletes).toBe(1);
    },
  );

  test("network failure refuses teardown with a fixed safe error and no raw transport output", async () => {
    let deletes = 0;
    const logs: string[] = [];
    globalThis.fetch = Object.assign(
      async () => {
        deletes++;
        throw new Error("synthetic-sensitive-transport-detail");
      },
      { preconnect: inertPreconnect },
    );
    const error = await neon.deprovision!(
      {
        cwd: h.dir,
        interactive: false,
        log(event) {
          logs.push(event.msg);
        },
      },
      { token: "synthetic-key" },
      "inert-project",
    ).catch((err: Error) => err);
    expect(error).toMatchObject({ code: "NEON_DELETE_UNCONFIRMED" });
    expect((error as Error).message).not.toContain("synthetic-sensitive-transport-detail");
    expect(logs.join(" ")).not.toContain("synthetic-sensitive-transport-detail");
    expect(deletes).toBe(1);
  });
});
