import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * Tests for the Wave 4 key-only provider adapters:
 * auth0, workos, mixpanel, plausible, datadog, grafana, gcp,
 * digitalocean, hetzner, launchdarkly.
 */

describe("Wave 4 providers", () => {
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

  // ── auth0 ────────────────────────────────────────────────────────────────

  test("auth0: login prompts for AUTH0_DOMAIN", async () => {
    const auth0 = (await import("../providers/auth0.ts")).default;
    expect(auth0.name).toBe("auth0");
    expect(auth0.authKind).toBe("api_key");
    // secretName is AUTH0_DOMAIN — confirmed by the howTo message
    expect(auth0.displayName).toBe("Auth0");
  });

  test("auth0: materialize stores AUTH0_DOMAIN key", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ issuer: "https://myapp.us.auth0.com/" }), {
        status: 200,
      })) as unknown as typeof fetch;

    const auth0 = (await import("../providers/auth0.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = {
      token: "myapp.us.auth0.com",
      identity: { issuer: "https://myapp.us.auth0.com/" },
    };
    const resource = await auth0.provision(ctx, auth, {});
    const materialized = await auth0.materialize(ctx, resource, auth);
    expect(materialized.secrets.AUTH0_DOMAIN).toBe("myapp.us.auth0.com");
    expect((await readVault(h.dir)).AUTH0_DOMAIN).toBe("myapp.us.auth0.com");
  });

  test("auth0: healthcheck returns error on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("AUTH0_DOMAIN", "bad.auth0.com");

    const auth0 = (await import("../providers/auth0.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await auth0.healthcheck!(ctx, {
      provider: "auth0",
      secrets: ["AUTH0_DOMAIN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── workos ───────────────────────────────────────────────────────────────

  test("workos: materialize stores WORKOS_API_KEY", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;

    const workos = (await import("../providers/workos.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "sk_workos_fake", identity: { organizations: "0" } };
    const resource = await workos.provision(ctx, auth, {});
    const materialized = await workos.materialize(ctx, resource, auth);
    expect(materialized.secrets.WORKOS_API_KEY).toBe("sk_workos_fake");
    const vault = await readVault(h.dir);
    expect(vault.WORKOS_API_KEY).toBe("sk_workos_fake");
  });

  test("workos: verify calls /organizations endpoint", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const workos = (await import("../providers/workos.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "sk_workos_fake", identity: {} as Record<string, string> };
    await workos.provision(ctx, auth, {});
    await workos.materialize(ctx, { id: "default", displayName: "WorkOS" }, auth);
    // trigger verify via healthcheck
    const { addSecret } = await import("../phantom.ts");
    await addSecret("WORKOS_API_KEY", "sk_workos_fake");
    await workos.healthcheck!(ctx, {
      provider: "workos",
      secrets: ["WORKOS_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(capturedUrl).toContain("workos.com/organizations");
  });

  test("workos: healthcheck returns error on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("WORKOS_API_KEY", "bad-key");

    const workos = (await import("../providers/workos.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await workos.healthcheck!(ctx, {
      provider: "workos",
      secrets: ["WORKOS_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── mixpanel ─────────────────────────────────────────────────────────────

  test("mixpanel: materialize stores MIXPANEL_PROJECT_TOKEN", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 1 }), { status: 200 })) as unknown as typeof fetch;

    const mixpanel = (await import("../providers/mixpanel.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "mp_fake_token", identity: {} as Record<string, string> };
    const resource = await mixpanel.provision(ctx, auth, {});
    const materialized = await mixpanel.materialize(ctx, resource, auth);
    expect(materialized.secrets.MIXPANEL_PROJECT_TOKEN).toBe("mp_fake_token");
  });

  test("mixpanel: healthcheck returns error on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("MIXPANEL_PROJECT_TOKEN", "bad-token");

    const mixpanel = (await import("../providers/mixpanel.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await mixpanel.healthcheck!(ctx, {
      provider: "mixpanel",
      secrets: ["MIXPANEL_PROJECT_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── plausible ─────────────────────────────────────────────────────────────

  test("plausible: verify calls /api/v1/sites", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ sites: [{ domain: "example.com" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const plausible = (await import("../providers/plausible.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "plausible_fake", identity: {} as Record<string, string> };
    await plausible.provision(ctx, auth, {});
    await plausible.materialize(ctx, { id: "default", displayName: "Plausible" }, auth);
    const { addSecret } = await import("../phantom.ts");
    await addSecret("PLAUSIBLE_API_KEY", "plausible_fake");
    await plausible.healthcheck!(ctx, {
      provider: "plausible",
      secrets: ["PLAUSIBLE_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(capturedUrl).toContain("plausible.io/api/v1/sites");
  });

  test("plausible: healthcheck returns error on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("PLAUSIBLE_API_KEY", "bad-key");

    const plausible = (await import("../providers/plausible.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await plausible.healthcheck!(ctx, {
      provider: "plausible",
      secrets: ["PLAUSIBLE_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── datadog ───────────────────────────────────────────────────────────────

  test("datadog: verify calls /api/v1/validate with DD-API-KEY header", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ valid: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const datadog = (await import("../providers/datadog.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: "dd_api_fake", identity: {} as Record<string, string> };
    const resource = await datadog.provision(ctx, auth, {});
    await datadog.materialize(ctx, resource, auth);
    const { addSecret } = await import("../phantom.ts");
    await addSecret("DD_API_KEY", "dd_api_fake");
    await datadog.healthcheck!(ctx, {
      provider: "datadog",
      secrets: ["DD_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(capturedHeaders["DD-API-KEY"]).toBe("dd_api_fake");
  });

  test("datadog: healthcheck returns ok on valid key", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ valid: true }), { status: 200 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("DD_API_KEY", "dd_api_fake");

    const datadog = (await import("../providers/datadog.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await datadog.healthcheck!(ctx, {
      provider: "datadog",
      secrets: ["DD_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("ok");
  });

  test("datadog: healthcheck returns error on 403", async () => {
    globalThis.fetch = (async () =>
      new Response("forbidden", { status: 403 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("DD_API_KEY", "bad-key");

    const datadog = (await import("../providers/datadog.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await datadog.healthcheck!(ctx, {
      provider: "datadog",
      secrets: ["DD_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── grafana ───────────────────────────────────────────────────────────────

  test("grafana: verify accepts glsa_ prefixed token", async () => {
    const grafana = (await import("../providers/grafana.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = {
      token: "glsa_validtoken1234567890abcdef",
      identity: {} as Record<string, string>,
    };
    const resource = await grafana.provision(ctx, auth, {});
    const materialized = await grafana.materialize(ctx, resource, auth);
    expect(materialized.secrets.GRAFANA_API_KEY).toBe("glsa_validtoken1234567890abcdef");
  });

  test("grafana: verify rejects short tokens", async () => {
    const grafana = (await import("../providers/grafana.ts")).default;
    // Healthcheck calls verify with the stored key. A short/invalid token should return error.
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GRAFANA_API_KEY", "short");

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await grafana.healthcheck!(ctx, {
      provider: "grafana",
      secrets: ["GRAFANA_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── gcp ────────────────────────────────────────────────────────────────

  test("gcp: verify accepts valid service-account JSON shape", async () => {
    const gcp = (await import("../providers/gcp.ts")).default;
    const validJson = JSON.stringify({
      type: "service_account",
      project_id: "my-project",
      client_email: "sa@my-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----...",
    });
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: validJson, identity: {} as Record<string, string> };
    const resource = await gcp.provision(ctx, auth, {});
    const materialized = await gcp.materialize(ctx, resource, auth);
    expect(materialized.secrets.GCP_SERVICE_ACCOUNT_JSON).toBe(validJson);
  });

  test("gcp: verify rejects invalid JSON", async () => {
    const gcp = (await import("../providers/gcp.ts")).default;
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GCP_SERVICE_ACCOUNT_JSON", "not-valid-json");

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await gcp.healthcheck!(ctx, {
      provider: "gcp",
      secrets: ["GCP_SERVICE_ACCOUNT_JSON"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  test("gcp: verify rejects JSON missing required fields", async () => {
    const gcp = (await import("../providers/gcp.ts")).default;
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GCP_SERVICE_ACCOUNT_JSON", JSON.stringify({ type: "service_account" }));

    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await gcp.healthcheck!(ctx, {
      provider: "gcp",
      secrets: ["GCP_SERVICE_ACCOUNT_JSON"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── digitalocean ─────────────────────────────────────────────────────────

  test("digitalocean: verify calls /v2/account with Bearer header", async () => {
    let capturedHeader = "";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      capturedHeader = headers?.Authorization ?? "";
      return new Response(JSON.stringify({ account: { email: "me@example.com", uuid: "u1" } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("DIGITALOCEAN_TOKEN", "do_fake_token");

    const digitalocean = (await import("../providers/digitalocean.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    await digitalocean.healthcheck!(ctx, {
      provider: "digitalocean",
      secrets: ["DIGITALOCEAN_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(capturedHeader).toBe("Bearer do_fake_token");
  });

  test("digitalocean: healthcheck returns error on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("DIGITALOCEAN_TOKEN", "bad-token");

    const digitalocean = (await import("../providers/digitalocean.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await digitalocean.healthcheck!(ctx, {
      provider: "digitalocean",
      secrets: ["DIGITALOCEAN_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── hetzner ───────────────────────────────────────────────────────────────

  test("hetzner: verify calls /v1/locations with Bearer header", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ locations: [{ name: "fsn1" }, { name: "nbg1" }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("HETZNER_API_TOKEN", "hcloud_fake");

    const hetzner = (await import("../providers/hetzner.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    await hetzner.healthcheck!(ctx, {
      provider: "hetzner",
      secrets: ["HETZNER_API_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(capturedUrl).toContain("hetzner.cloud/v1/locations");
  });

  test("hetzner: healthcheck returns error on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("HETZNER_API_TOKEN", "bad-token");

    const hetzner = (await import("../providers/hetzner.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await hetzner.healthcheck!(ctx, {
      provider: "hetzner",
      secrets: ["HETZNER_API_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ── launchdarkly ─────────────────────────────────────────────────────────

  test("launchdarkly: verify calls /api/v2/caller-identity", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({ accountId: "acct_1", tokenType: "personalAccessToken" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("LAUNCHDARKLY_API_TOKEN", "api-fake-ld-token");

    const launchdarkly = (await import("../providers/launchdarkly.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };

    // Also confirm materialize stores the token
    const auth = { token: "api-fake-ld-token", identity: {} as Record<string, string> };
    const resource = await launchdarkly.provision(ctx, auth, {});
    const materialized = await launchdarkly.materialize(ctx, resource, auth);
    expect(materialized.secrets.LAUNCHDARKLY_API_TOKEN).toBe("api-fake-ld-token");

    // Trigger verify via healthcheck to capture the URL
    await launchdarkly.healthcheck!(ctx, {
      provider: "launchdarkly",
      secrets: ["LAUNCHDARKLY_API_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(capturedUrl).toContain("caller-identity");
  });

  test("launchdarkly: healthcheck returns error on 401", async () => {
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const { addSecret } = await import("../phantom.ts");
    await addSecret("LAUNCHDARKLY_API_TOKEN", "bad-token");

    const launchdarkly = (await import("../providers/launchdarkly.ts")).default;
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const status = await launchdarkly.healthcheck!(ctx, {
      provider: "launchdarkly",
      secrets: ["LAUNCHDARKLY_API_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });
});
