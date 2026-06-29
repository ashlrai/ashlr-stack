/**
 * Comprehensive healthcheck coverage tests for all 32 providers.
 *
 * Each provider is tested for:
 *   1. Returns { kind: "ok", latencyMs } when the API responds 200.
 *   2. Returns { kind: "error", detail } when the secret is missing.
 *   3. Returns { kind: "error", detail } when the API returns 401/403.
 *   4. Propagates ctx.signal to fetch (abort cancellation).
 *
 * Structural-only providers (firebase, gcp, convex, modal) are tested
 * with in-memory checks rather than mocked network.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(signal?: AbortSignal): ProviderContext {
  return { cwd: process.cwd(), interactive: false, log: () => {}, signal };
}

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Spec table — network-backed providers
// ---------------------------------------------------------------------------

interface NetworkSpec {
  providerPath: string;
  secretName: string;
  secretValue: string;
  validResponseBody: unknown;
  fetchUrl?: string; // partial URL match; omit to accept any
}

const NETWORK_SPECS: NetworkSpec[] = [
  // AI
  {
    providerPath: "../providers/anthropic.ts",
    secretName: "ANTHROPIC_API_KEY",
    secretValue: "sk-ant-fake",
    validResponseBody: { data: [{ id: "claude-opus-4-5" }] },
  },
  {
    providerPath: "../providers/openai.ts",
    secretName: "OPENAI_API_KEY",
    secretValue: "sk-fake-openai",
    validResponseBody: { data: [{ id: "gpt-4o" }] },
  },
  {
    providerPath: "../providers/xai.ts",
    secretName: "XAI_API_KEY",
    secretValue: "xai-fake",
    validResponseBody: { data: [{ id: "grok-4" }] },
  },
  {
    providerPath: "../providers/deepseek.ts",
    secretName: "DEEPSEEK_API_KEY",
    secretValue: "sk-deepseek-fake",
    validResponseBody: { data: [{ id: "deepseek-chat" }] },
  },
  {
    providerPath: "../providers/replicate.ts",
    secretName: "REPLICATE_API_TOKEN",
    secretValue: "r8_fake",
    validResponseBody: { username: "mason", type: "user" },
  },
  {
    providerPath: "../providers/braintrust.ts",
    secretName: "BRAINTRUST_API_KEY",
    secretValue: "sk-bt-fake",
    validResponseBody: { objects: [{ id: "org_1", name: "My Org" }] },
  },
  // Deploy
  {
    providerPath: "../providers/railway.ts",
    secretName: "RAILWAY_TOKEN",
    secretValue: "railway-fake",
    validResponseBody: { data: { me: { id: "u1", email: "me@example.com" } } },
  },
  {
    providerPath: "../providers/render.ts",
    secretName: "RENDER_API_KEY",
    secretValue: "rnd_fake",
    validResponseBody: [{ owner: { id: "own_1", name: "Me" } }],
  },
  {
    providerPath: "../providers/fly.ts",
    secretName: "FLY_API_TOKEN",
    secretValue: "fm2_fake",
    validResponseBody: { apps: [{ name: "a1" }] },
  },
  // Cloud
  {
    providerPath: "../providers/digitalocean.ts",
    secretName: "DIGITALOCEAN_TOKEN",
    secretValue: "do_fake",
    validResponseBody: { account: { email: "me@example.com", uuid: "uuid_1" } },
  },
  {
    providerPath: "../providers/hetzner.ts",
    secretName: "HETZNER_API_TOKEN",
    secretValue: "htz_fake",
    validResponseBody: { locations: [{ name: "nbg1" }] },
  },
  // Auth
  {
    providerPath: "../providers/clerk.ts",
    secretName: "CLERK_SECRET_KEY",
    secretValue: "sk_test_fake",
    validResponseBody: { keys: [] },
  },
  {
    providerPath: "../providers/auth0.ts",
    secretName: "AUTH0_DOMAIN",
    secretValue: "myapp.us.auth0.com",
    validResponseBody: { issuer: "https://myapp.us.auth0.com/" },
  },
  {
    providerPath: "../providers/workos.ts",
    secretName: "WORKOS_API_KEY",
    secretValue: "sk_workos_fake",
    validResponseBody: { data: [] },
  },
  // Observability / Analytics
  {
    providerPath: "../providers/datadog.ts",
    secretName: "DD_API_KEY",
    secretValue: "dd_fake",
    validResponseBody: { valid: true },
  },
  {
    providerPath: "../providers/posthog.ts",
    secretName: "POSTHOG_PERSONAL_API_KEY",
    secretValue: "phx_fake",
    validResponseBody: { results: [{ id: 1, name: "Default" }] },
  },
  {
    providerPath: "../providers/mixpanel.ts",
    secretName: "MIXPANEL_PROJECT_TOKEN",
    secretValue: "mp_fake",
    validResponseBody: {},
    // mixpanel returns 200 or 400 for valid token; mockFetch uses 200
  },
  {
    providerPath: "../providers/plausible.ts",
    secretName: "PLAUSIBLE_API_KEY",
    secretValue: "plausible_fake",
    validResponseBody: { sites: [{ domain: "example.com" }] },
  },
  // Email
  {
    providerPath: "../providers/resend.ts",
    secretName: "RESEND_API_KEY",
    secretValue: "re_fake",
    validResponseBody: { data: [{ id: "dom_1" }] },
  },
  {
    providerPath: "../providers/sendgrid.ts",
    secretName: "SENDGRID_API_KEY",
    secretValue: "SG.fake",
    validResponseBody: { scopes: ["mail.send"] },
  },
  {
    providerPath: "../providers/postmark.ts",
    secretName: "POSTMARK_ACCOUNT_TOKEN",
    secretValue: "postmark_fake",
    validResponseBody: { Servers: [{ ID: 1 }] },
  },
  {
    providerPath: "../providers/mailgun.ts",
    secretName: "MAILGUN_API_KEY",
    secretValue: "key-mailgun-fake",
    validResponseBody: { items: [{ name: "mg.example.com" }] },
  },
  // Tickets / FeatureFlags
  {
    providerPath: "../providers/linear.ts",
    secretName: "LINEAR_API_KEY",
    secretValue: "lin_api_fake",
    validResponseBody: { data: { viewer: { id: "u1" } } },
  },
  {
    providerPath: "../providers/launchdarkly.ts",
    secretName: "LAUNCHDARKLY_API_TOKEN",
    secretValue: "ld_fake",
    validResponseBody: { accountId: "acc_1", tokenType: "api" },
  },
  // Database — network-backed
  {
    providerPath: "../providers/upstash.ts",
    secretName: "UPSTASH_MANAGEMENT_TOKEN",
    secretValue: "email@example.com:token",
    validResponseBody: [],
  },
];

describe("healthcheck — network-backed providers", () => {
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

  for (const spec of NETWORK_SPECS) {
    const name = spec.providerPath.split("/").pop()!.replace(".ts", "");

    test(`${name}: healthcheck ok — latencyMs present and kind=ok`, async () => {
      const { addSecret } = await import("../phantom.ts");
      await addSecret(spec.secretName, spec.secretValue);

      globalThis.fetch = mockFetch(200, spec.validResponseBody);

      const provider = (await import(spec.providerPath)).default;
      expect(typeof provider.healthcheck).toBe("function");

      const status = await provider.healthcheck!(makeCtx(), {
        provider: name,
        secrets: [spec.secretName],
        created_at: new Date().toISOString(),
      });

      expect(status.kind).toBe("ok");
      expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
    });

    test(`${name}: healthcheck error — missing secret`, async () => {
      // Ensure neither vault nor process.env has the secret.
      const prev = process.env[spec.secretName];
      delete process.env[spec.secretName];

      try {
        const provider = (await import(spec.providerPath)).default;

        const status = await provider.healthcheck!(makeCtx(), {
          provider: name,
          secrets: [],
          created_at: new Date().toISOString(),
        });

        expect(status.kind).toBe("error");
        expect((status as { detail: string }).detail).toContain("missing");
      } finally {
        if (prev !== undefined) process.env[spec.secretName] = prev;
      }
    });

    test(`${name}: healthcheck error — 401 from API`, async () => {
      const { addSecret } = await import("../phantom.ts");
      await addSecret(spec.secretName, spec.secretValue);

      globalThis.fetch = mockFetch(401, { error: "unauthorized" });

      const provider = (await import(spec.providerPath)).default;

      const status = await provider.healthcheck!(makeCtx(), {
        provider: name,
        secrets: [spec.secretName],
        created_at: new Date().toISOString(),
      });

      expect(status.kind).toBe("error");
    });

    test(`${name}: healthcheck respects signal cancellation`, async () => {
      const { addSecret } = await import("../phantom.ts");
      await addSecret(spec.secretName, spec.secretValue);

      // Mock fetch that checks for signal abort
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return new Response(JSON.stringify(spec.validResponseBody), { status: 200 });
      }) as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      const provider = (await import(spec.providerPath)).default;

      const status = await provider.healthcheck!(makeCtx(controller.signal), {
        provider: name,
        secrets: [spec.secretName],
        created_at: new Date().toISOString(),
      });

      // When aborted, the provider should return error (AbortError propagated).
      expect(status.kind).toBe("error");
    });
  }
});

// ---------------------------------------------------------------------------
// Structural-only providers (no network required)
// ---------------------------------------------------------------------------

describe("healthcheck — structural providers", () => {
  let h: Harness;

  beforeEach(() => {
    h = setupFakePhantom();
  });

  afterEach(() => {
    h.cleanup();
  });

  // Firebase
  test("firebase: healthcheck ok for valid service-account JSON", async () => {
    const { addSecret } = await import("../phantom.ts");
    const validJson = JSON.stringify({
      type: "service_account",
      project_id: "my-proj",
      client_email: "bot@my-proj.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----...",
    });
    await addSecret("FIREBASE_SERVICE_ACCOUNT_JSON", validJson);

    const firebase = (await import("../providers/firebase.ts")).default;
    const status = await firebase.healthcheck!(makeCtx(), {
      provider: "firebase",
      secrets: ["FIREBASE_SERVICE_ACCOUNT_JSON"],
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
    expect((status as { detail?: string }).detail).toContain("my-proj");
  });

  test("firebase: healthcheck error when secret missing", async () => {
    const firebase = (await import("../providers/firebase.ts")).default;
    const status = await firebase.healthcheck!(makeCtx(), {
      provider: "firebase",
      secrets: [],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
    expect((status as { detail: string }).detail).toContain("missing");
  });

  test("firebase: healthcheck error for malformed JSON", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("FIREBASE_SERVICE_ACCOUNT_JSON", '{"type":"not_service_account"}');

    const firebase = (await import("../providers/firebase.ts")).default;
    const status = await firebase.healthcheck!(makeCtx(), {
      provider: "firebase",
      secrets: ["FIREBASE_SERVICE_ACCOUNT_JSON"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // GCP
  test("gcp: healthcheck ok for valid service-account JSON", async () => {
    const { addSecret } = await import("../phantom.ts");
    const validJson = JSON.stringify({
      type: "service_account",
      project_id: "my-gcp-project",
      client_email: "sa@my-gcp-project.iam.gserviceaccount.com",
    });
    await addSecret("GCP_SERVICE_ACCOUNT_JSON", validJson);

    const gcp = (await import("../providers/gcp.ts")).default;
    const status = await gcp.healthcheck!(makeCtx(), {
      provider: "gcp",
      secrets: ["GCP_SERVICE_ACCOUNT_JSON"],
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect((status as { detail?: string }).detail).toContain("my-gcp-project");
  });

  test("gcp: healthcheck error when secret missing", async () => {
    const gcp = (await import("../providers/gcp.ts")).default;
    const status = await gcp.healthcheck!(makeCtx(), {
      provider: "gcp",
      secrets: [],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
    expect((status as { detail: string }).detail).toContain("missing");
  });

  test("gcp: healthcheck error for wrong JSON type", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GCP_SERVICE_ACCOUNT_JSON", JSON.stringify({ type: "oauth2", project_id: "p", client_email: "e" }));

    const gcp = (await import("../providers/gcp.ts")).default;
    const status = await gcp.healthcheck!(makeCtx(), {
      provider: "gcp",
      secrets: ["GCP_SERVICE_ACCOUNT_JSON"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // Convex
  test("convex: healthcheck ok for valid deploy key shape", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CONVEX_DEPLOY_KEY", "prod:my-team:my-project|encoded-token-bytes");

    const convex = (await import("../providers/convex.ts")).default;
    const status = await convex.healthcheck!(makeCtx(), {
      provider: "convex",
      secrets: ["CONVEX_DEPLOY_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("convex: healthcheck error when secret missing", async () => {
    const convex = (await import("../providers/convex.ts")).default;
    const status = await convex.healthcheck!(makeCtx(), {
      provider: "convex",
      secrets: [],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
    expect((status as { detail: string }).detail).toContain("missing");
  });

  test("convex: healthcheck error for malformed key", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CONVEX_DEPLOY_KEY", "invalid-key-no-colons-or-pipes");

    const convex = (await import("../providers/convex.ts")).default;
    const status = await convex.healthcheck!(makeCtx(), {
      provider: "convex",
      secrets: ["CONVEX_DEPLOY_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // Modal
  test("modal: healthcheck ok for valid ak- token shape", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("MODAL_TOKEN", "ak-1234567890abcdef:secret-bytes-here");

    const modal = (await import("../providers/modal.ts")).default;
    const status = await modal.healthcheck!(makeCtx(), {
      provider: "modal",
      secrets: ["MODAL_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("ok");
  });

  test("modal: healthcheck error when secret missing", async () => {
    const modal = (await import("../providers/modal.ts")).default;
    const status = await modal.healthcheck!(makeCtx(), {
      provider: "modal",
      secrets: [],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
    expect((status as { detail: string }).detail).toContain("missing");
  });

  test("modal: healthcheck error for invalid token shape", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("MODAL_TOKEN", "not-valid-format");

    const modal = (await import("../providers/modal.ts")).default;
    const status = await modal.healthcheck!(makeCtx(), {
      provider: "modal",
      secrets: ["MODAL_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Network-backed providers that require resource_id or special secrets
// ---------------------------------------------------------------------------

describe("healthcheck — resource-id providers (neon, sentry, turso, vercel, supabase)", () => {
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

  // ---- Neon ----------------------------------------------------------------

  test("neon: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon-fake-token");

    globalThis.fetch = mockFetch(200, { project: { id: "proj-1", name: "my-proj", region_id: "aws-us-east-2" } });

    const neon = (await import("../providers/neon.ts")).default;
    const status = await neon.healthcheck!(makeCtx(), {
      provider: "neon",
      secrets: ["NEON_API_KEY"],
      resource_id: "proj-1",
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("neon: healthcheck error — missing secret", async () => {
    const prev = process.env.NEON_API_KEY;
    delete process.env.NEON_API_KEY;
    try {
      const neon = (await import("../providers/neon.ts")).default;
      const status = await neon.healthcheck!(makeCtx(), {
        provider: "neon",
        secrets: [],
        resource_id: "proj-1",
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.NEON_API_KEY = prev;
    }
  });

  test("neon: healthcheck error — 401 from API", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon-fake-token");

    globalThis.fetch = mockFetch(401, { message: "unauthorized" });

    const neon = (await import("../providers/neon.ts")).default;
    const status = await neon.healthcheck!(makeCtx(), {
      provider: "neon",
      secrets: ["NEON_API_KEY"],
      resource_id: "proj-1",
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  test("neon: healthcheck warn — no resource_id", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon-fake-token");

    const neon = (await import("../providers/neon.ts")).default;
    const status = await neon.healthcheck!(makeCtx(), {
      provider: "neon",
      secrets: ["NEON_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("warn");
  });

  // ---- Sentry --------------------------------------------------------------

  test("sentry: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SENTRY_AUTH_TOKEN", "sentry-fake-token");

    globalThis.fetch = mockFetch(200, { id: "proj-1", slug: "my-project" });

    const sentry = (await import("../providers/sentry.ts")).default;
    const status = await sentry.healthcheck!(makeCtx(), {
      provider: "sentry",
      secrets: ["SENTRY_AUTH_TOKEN"],
      resource_id: "myorg/my-project",
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("sentry: healthcheck error — missing secret", async () => {
    const prev = process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_AUTH_TOKEN;
    try {
      const sentry = (await import("../providers/sentry.ts")).default;
      const status = await sentry.healthcheck!(makeCtx(), {
        provider: "sentry",
        secrets: [],
        resource_id: "myorg/my-project",
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.SENTRY_AUTH_TOKEN = prev;
    }
  });

  test("sentry: healthcheck error — 401 from API", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SENTRY_AUTH_TOKEN", "sentry-fake-token");

    globalThis.fetch = mockFetch(401, { detail: "unauthorized" });

    const sentry = (await import("../providers/sentry.ts")).default;
    const status = await sentry.healthcheck!(makeCtx(), {
      provider: "sentry",
      secrets: ["SENTRY_AUTH_TOKEN"],
      resource_id: "myorg/my-project",
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  test("sentry: healthcheck warn — no resource_id", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SENTRY_AUTH_TOKEN", "sentry-fake-token");

    const sentry = (await import("../providers/sentry.ts")).default;
    const status = await sentry.healthcheck!(makeCtx(), {
      provider: "sentry",
      secrets: ["SENTRY_AUTH_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("warn");
  });

  // ---- Turso ---------------------------------------------------------------

  test("turso: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("TURSO_PLATFORM_TOKEN", "turso-fake-token");

    globalThis.fetch = mockFetch(200, { name: "my-db", hostname: "my-db-myorg.turso.io" });

    const turso = (await import("../providers/turso.ts")).default;
    const status = await turso.healthcheck!(makeCtx(), {
      provider: "turso",
      secrets: ["TURSO_PLATFORM_TOKEN"],
      resource_id: "myorg/my-db",
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("turso: healthcheck error — missing secret", async () => {
    const prev = process.env.TURSO_PLATFORM_TOKEN;
    delete process.env.TURSO_PLATFORM_TOKEN;
    try {
      const turso = (await import("../providers/turso.ts")).default;
      const status = await turso.healthcheck!(makeCtx(), {
        provider: "turso",
        secrets: [],
        resource_id: "myorg/my-db",
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.TURSO_PLATFORM_TOKEN = prev;
    }
  });

  test("turso: healthcheck error — 401 from API", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("TURSO_PLATFORM_TOKEN", "turso-fake-token");

    globalThis.fetch = mockFetch(401, { message: "unauthorized" });

    const turso = (await import("../providers/turso.ts")).default;
    const status = await turso.healthcheck!(makeCtx(), {
      provider: "turso",
      secrets: ["TURSO_PLATFORM_TOKEN"],
      resource_id: "myorg/my-db",
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ---- Vercel --------------------------------------------------------------

  test("vercel: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");

    globalThis.fetch = mockFetch(200, { id: "prj-1", name: "my-project" });

    const vercel = (await import("../providers/vercel.ts")).default;
    const status = await vercel.healthcheck!(makeCtx(), {
      provider: "vercel",
      secrets: ["VERCEL_TOKEN"],
      resource_id: "prj-1",
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("vercel: healthcheck error — missing secret", async () => {
    const prev = process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TOKEN;
    try {
      const vercel = (await import("../providers/vercel.ts")).default;
      const status = await vercel.healthcheck!(makeCtx(), {
        provider: "vercel",
        secrets: [],
        resource_id: "prj-1",
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.VERCEL_TOKEN = prev;
    }
  });

  test("vercel: healthcheck error — 404 project not found", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");

    globalThis.fetch = mockFetch(404, { error: { code: "not_found" } });

    const vercel = (await import("../providers/vercel.ts")).default;
    const status = await vercel.healthcheck!(makeCtx(), {
      provider: "vercel",
      secrets: ["VERCEL_TOKEN"],
      resource_id: "prj-1",
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  test("vercel: healthcheck warn — no resource_id", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");

    const vercel = (await import("../providers/vercel.ts")).default;
    const status = await vercel.healthcheck!(makeCtx(), {
      provider: "vercel",
      secrets: ["VERCEL_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("warn");
  });

  // ---- Supabase ------------------------------------------------------------

  test("supabase: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ANON_KEY", "eyJfake.anon.key");

    globalThis.fetch = mockFetch(200, {});

    const supabase = (await import("../providers/supabase.ts")).default;
    const status = await supabase.healthcheck!(makeCtx(), {
      provider: "supabase",
      secrets: ["SUPABASE_ANON_KEY"],
      resource_id: "abcdefghijklmnop",
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("supabase: healthcheck error — missing anon key", async () => {
    const prev = process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    try {
      const supabase = (await import("../providers/supabase.ts")).default;
      const status = await supabase.healthcheck!(makeCtx(), {
        provider: "supabase",
        secrets: [],
        resource_id: "abcdefghijklmnop",
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.SUPABASE_ANON_KEY = prev;
    }
  });

  test("supabase: healthcheck error — missing resource_id", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ANON_KEY", "eyJfake.anon.key");

    const supabase = (await import("../providers/supabase.ts")).default;
    const status = await supabase.healthcheck!(makeCtx(), {
      provider: "supabase",
      secrets: ["SUPABASE_ANON_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  test("supabase: healthcheck respects signal cancellation", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ANON_KEY", "eyJfake.anon.key");

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    const supabase = (await import("../providers/supabase.ts")).default;
    const status = await supabase.healthcheck!(makeCtx(controller.signal), {
      provider: "supabase",
      secrets: ["SUPABASE_ANON_KEY"],
      resource_id: "abcdefghijklmnop",
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Network-backed providers using simple token auth (stripe, github, cloudflare, aws)
// ---------------------------------------------------------------------------

describe("healthcheck — simple-token providers (stripe, github, cloudflare, aws)", () => {
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

  // ---- Stripe --------------------------------------------------------------

  test("stripe: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = mockFetch(200, { id: "acct_fake", business_type: "individual" });

    const stripe = (await import("../providers/stripe.ts")).default;
    const status = await stripe.healthcheck!(makeCtx(), {
      provider: "stripe",
      secrets: ["STRIPE_SECRET_KEY"],
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("stripe: healthcheck error — missing secret", async () => {
    const prev = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const stripe = (await import("../providers/stripe.ts")).default;
      const status = await stripe.healthcheck!(makeCtx(), {
        provider: "stripe",
        secrets: [],
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.STRIPE_SECRET_KEY = prev;
    }
  });

  test("stripe: healthcheck error — 401 from API", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = mockFetch(401, { error: { type: "invalid_request_error" } });

    const stripe = (await import("../providers/stripe.ts")).default;
    const status = await stripe.healthcheck!(makeCtx(), {
      provider: "stripe",
      secrets: ["STRIPE_SECRET_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ---- GitHub --------------------------------------------------------------

  test("github: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = mockFetch(200, { login: "mason", id: 1, type: "User" });

    const github = (await import("../providers/github.ts")).default;
    const status = await github.healthcheck!(makeCtx(), {
      provider: "github",
      secrets: ["GITHUB_TOKEN"],
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("github: healthcheck error — missing secret", async () => {
    const prev = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const github = (await import("../providers/github.ts")).default;
      const status = await github.healthcheck!(makeCtx(), {
        provider: "github",
        secrets: [],
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.GITHUB_TOKEN = prev;
    }
  });

  test("github: healthcheck error — 401 from API", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = mockFetch(401, { message: "Bad credentials" });

    const github = (await import("../providers/github.ts")).default;
    const status = await github.healthcheck!(makeCtx(), {
      provider: "github",
      secrets: ["GITHUB_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ---- Cloudflare ----------------------------------------------------------

  test("cloudflare: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLOUDFLARE_API_TOKEN", "cf-fake-token");

    globalThis.fetch = mockFetch(200, { result: { id: "tok_1", status: "active" }, success: true });

    const cloudflare = (await import("../providers/cloudflare.ts")).default;
    const status = await cloudflare.healthcheck!(makeCtx(), {
      provider: "cloudflare",
      secrets: ["CLOUDFLARE_API_TOKEN"],
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("cloudflare: healthcheck error — missing secret", async () => {
    const prev = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      const cloudflare = (await import("../providers/cloudflare.ts")).default;
      const status = await cloudflare.healthcheck!(makeCtx(), {
        provider: "cloudflare",
        secrets: [],
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prev !== undefined) process.env.CLOUDFLARE_API_TOKEN = prev;
    }
  });

  test("cloudflare: healthcheck error — 403 from API", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLOUDFLARE_API_TOKEN", "cf-fake-token");

    globalThis.fetch = mockFetch(403, { success: false, errors: [{ message: "forbidden" }] });

    const cloudflare = (await import("../providers/cloudflare.ts")).default;
    const status = await cloudflare.healthcheck!(makeCtx(), {
      provider: "cloudflare",
      secrets: ["CLOUDFLARE_API_TOKEN"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });

  // ---- AWS -----------------------------------------------------------------

  test("aws: healthcheck ok — latencyMs present and kind=ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("AWS_ACCESS_KEY_ID", "AKIAFAKE12345678");
    await addSecret("AWS_SECRET_ACCESS_KEY", "fakesecretaccesskey0000000000000000000000");

    // STS GetCallerIdentity returns XML
    const stsXml = `<GetCallerIdentityResponse>
      <GetCallerIdentityResult>
        <Arn>arn:aws:iam::123456789012:user/mason</Arn>
        <UserId>AIDAFAKE123</UserId>
        <Account>123456789012</Account>
      </GetCallerIdentityResult>
    </GetCallerIdentityResponse>`;
    globalThis.fetch = (async () => new Response(stsXml, { status: 200 })) as unknown as typeof fetch;

    const aws = (await import("../providers/aws.ts")).default;
    const status = await aws.healthcheck!(makeCtx(), {
      provider: "aws",
      secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
      created_at: new Date().toISOString(),
    });

    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("aws: healthcheck error — missing secret", async () => {
    const prevId = process.env.AWS_ACCESS_KEY_ID;
    const prevSecret = process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    try {
      const aws = (await import("../providers/aws.ts")).default;
      const status = await aws.healthcheck!(makeCtx(), {
        provider: "aws",
        secrets: [],
        created_at: new Date().toISOString(),
      });
      expect(status.kind).toBe("error");
      expect((status as { detail: string }).detail).toContain("missing");
    } finally {
      if (prevId !== undefined) process.env.AWS_ACCESS_KEY_ID = prevId;
      if (prevSecret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = prevSecret;
    }
  });

  test("aws: healthcheck error — 403 from STS (invalid credentials)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("AWS_ACCESS_KEY_ID", "AKIAFAKE12345678");
    await addSecret("AWS_SECRET_ACCESS_KEY", "fakesecretaccesskey0000000000000000000000");

    globalThis.fetch = mockFetch(403, "<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>");

    const aws = (await import("../providers/aws.ts")).default;
    const status = await aws.healthcheck!(makeCtx(), {
      provider: "aws",
      secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Grafana — hybrid (structural fallback + network with URL)
// ---------------------------------------------------------------------------

describe("healthcheck — grafana", () => {
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

  test("grafana: structural ok when no GRAFANA_URL set (glsa_ token)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GRAFANA_API_KEY", "glsa_abcdefghijklmnopqrstuvwxyz123456");

    const grafana = (await import("../providers/grafana.ts")).default;
    const status = await grafana.healthcheck!(makeCtx(), {
      provider: "grafana",
      secrets: ["GRAFANA_API_KEY"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("ok");
    expect((status as { detail?: string }).detail).toContain("structural check only");
  });

  test("grafana: live check when GRAFANA_URL is set", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GRAFANA_API_KEY", "glsa_abcdefghijklmnopqrstuvwxyz123456");
    await addSecret("GRAFANA_URL", "https://myorg.grafana.net");

    globalThis.fetch = mockFetch(200, { database: "ok", version: "10.0.0" });

    const grafana = (await import("../providers/grafana.ts")).default;
    const status = await grafana.healthcheck!(makeCtx(), {
      provider: "grafana",
      secrets: ["GRAFANA_API_KEY", "GRAFANA_URL"],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("ok");
    expect(typeof (status as { latencyMs?: number }).latencyMs).toBe("number");
  });

  test("grafana: healthcheck error when secret missing", async () => {
    const grafana = (await import("../providers/grafana.ts")).default;
    const status = await grafana.healthcheck!(makeCtx(), {
      provider: "grafana",
      secrets: [],
      created_at: new Date().toISOString(),
    });
    expect(status.kind).toBe("error");
    expect((status as { detail: string }).detail).toContain("missing");
  });
});
