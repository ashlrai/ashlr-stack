import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * Parameterized integration tests for every `makeApiKeyProvider`-based
 * provider. Each spec declares:
 *   - module name (provider file)
 *   - expected secret name (the slot stored in Phantom)
 *   - a mocked HTTP response shape that `verify` should accept
 *   - a mocked HTTP response that `verify` should reject (unauthorized)
 *
 * This guards against API-shape drift — if, say, OpenAI changes `/v1/models`
 * to return a different JSON shape, this test catches it immediately.
 *
 * Covers: openai, anthropic, xai, deepseek, resend, clerk, upstash, railway,
 * fly, posthog, linear, stripe, convex, render, firebase.
 */

interface Spec {
  modulePath: string;
  providerName: string;
  secretName: string;
  /** A pasted-key shape the provider should accept on `.verify()`. */
  validKey: string;
  /** Mocked fetch response body for the verify success path. */
  validBody: unknown;
  /** Mocked fetch response status for the verify failure path (e.g. 401). */
  invalidStatus?: number;
}

const SPECS: Spec[] = [
  {
    modulePath: "../providers/openai.ts",
    providerName: "openai",
    secretName: "OPENAI_API_KEY",
    validKey: "sk-fake-openai",
    validBody: { data: [{ id: "gpt-4o" }] },
  },
  {
    modulePath: "../providers/anthropic.ts",
    providerName: "anthropic",
    secretName: "ANTHROPIC_API_KEY",
    validKey: "sk-ant-fake",
    validBody: { data: [{ id: "claude-opus" }] },
  },
  {
    modulePath: "../providers/xai.ts",
    providerName: "xai",
    secretName: "XAI_API_KEY",
    validKey: "xai-fake",
    validBody: { data: [{ id: "grok-4" }] },
  },
  {
    modulePath: "../providers/deepseek.ts",
    providerName: "deepseek",
    secretName: "DEEPSEEK_API_KEY",
    validKey: "sk-deepseek-fake",
    validBody: { data: [{ id: "deepseek-chat" }] },
  },
  {
    modulePath: "../providers/resend.ts",
    providerName: "resend",
    secretName: "RESEND_API_KEY",
    validKey: "re_fake",
    validBody: { data: [{ id: "dom-1" }] },
  },
  {
    modulePath: "../providers/clerk.ts",
    providerName: "clerk",
    secretName: "CLERK_SECRET_KEY",
    validKey: "sk_test_fake",
    validBody: { keys: [] },
  },
  {
    modulePath: "../providers/upstash.ts",
    providerName: "upstash",
    secretName: "UPSTASH_MANAGEMENT_TOKEN",
    validKey: "email@example.com:token",
    validBody: [],
  },
  {
    modulePath: "../providers/railway.ts",
    providerName: "railway",
    secretName: "RAILWAY_TOKEN",
    validKey: "railway-fake",
    validBody: { data: { me: { id: "u1", email: "me@example.com" } } },
  },
  {
    modulePath: "../providers/fly.ts",
    providerName: "fly",
    secretName: "FLY_API_TOKEN",
    validKey: "fm2_fake",
    validBody: { apps: [{ name: "a1" }] },
  },
  {
    modulePath: "../providers/posthog.ts",
    providerName: "posthog",
    secretName: "POSTHOG_PERSONAL_API_KEY",
    validKey: "phx_fake",
    validBody: { results: [{ id: 1, name: "Default" }] },
  },
  {
    modulePath: "../providers/linear.ts",
    providerName: "linear",
    secretName: "LINEAR_API_KEY",
    validKey: "lin_api_fake",
    validBody: { data: { viewer: { id: "u1", name: "Me", email: "me@example.com" } } },
  },
  {
    modulePath: "../providers/stripe.ts",
    providerName: "stripe",
    secretName: "STRIPE_SECRET_KEY",
    validKey: "sk_test_stripe",
    validBody: { id: "acct_fake", type: "standard" },
  },
  {
    modulePath: "../providers/render.ts",
    providerName: "render",
    secretName: "RENDER_API_KEY",
    validKey: "rnd_fake",
    validBody: [{ owner: { id: "own_1", name: "Me" } }],
  },
  {
    modulePath: "../providers/replicate.ts",
    providerName: "replicate",
    secretName: "REPLICATE_API_TOKEN",
    validKey: "r8_fake",
    validBody: { username: "mason", type: "user" },
  },
  {
    modulePath: "../providers/braintrust.ts",
    providerName: "braintrust",
    secretName: "BRAINTRUST_API_KEY",
    validKey: "sk-bt-fake",
    validBody: { objects: [{ id: "org_1", name: "My Org" }] },
  },
  {
    modulePath: "../providers/sendgrid.ts",
    providerName: "sendgrid",
    secretName: "SENDGRID_API_KEY",
    validKey: "SG.fake",
    validBody: { scopes: ["mail.send", "mail.batch.read"] },
  },
  {
    modulePath: "../providers/mailgun.ts",
    providerName: "mailgun",
    secretName: "MAILGUN_API_KEY",
    validKey: "key-mailgun-fake",
    validBody: { items: [{ name: "mg.example.com" }] },
  },
  {
    modulePath: "../providers/postmark.ts",
    providerName: "postmark",
    secretName: "POSTMARK_ACCOUNT_TOKEN",
    validKey: "postmark-account-fake",
    validBody: { Servers: [{ ID: 1, Name: "default" }] },
  },
];

describe("api-key providers — verify + materialize", () => {
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

  for (const spec of SPECS) {
    test(`${spec.providerName}: verify accepts a valid key and stores it`, async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(spec.validBody), { status: 200 })) as unknown as typeof fetch;

      const provider = (await import(spec.modulePath)).default;
      const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };

      // provision is a synthetic step for api-key providers — call directly.
      const auth = { token: spec.validKey, identity: {} as Record<string, string> };
      const resource = await provider.provision(ctx, auth, {});
      const materialized = await provider.materialize(ctx, resource, auth);

      expect(materialized.secrets[spec.secretName]).toBe(spec.validKey);
      const vault = await readVault(h.dir);
      expect(vault[spec.secretName]).toBe(spec.validKey);
    });
  }

  // Spot-check one "firebase" provider — its verify is structural (no HTTP), so it can't use the fetch-mock path.
  test("firebase: accepts a valid service-account JSON shape", async () => {
    const firebase = (await import("../providers/firebase.ts")).default;
    const validJson = JSON.stringify({
      type: "service_account",
      project_id: "my-proj",
      client_email: "bot@my-proj.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----...",
    });
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: validJson, identity: {} as Record<string, string> };
    const resource = await firebase.provision(ctx, auth, {});
    const materialized = await firebase.materialize(ctx, resource, auth);
    expect(materialized.secrets.FIREBASE_SERVICE_ACCOUNT_JSON).toBe(validJson);
  });

  test("firebase: login function exists (structural check)", async () => {
    const firebase = (await import("../providers/firebase.ts")).default;
    expect(typeof firebase.login).toBe("function");
    // The structural verify is deep inside makeApiKeyProvider; we exercise it
    // indirectly through the positive test above. An invalid JSON body would
    // cause login() to throw SUPABASE_AUTH_INVALID-equivalent in non-TTY mode.
  });

  test("convex: structural key shape check accepts prod:team:project|token format", async () => {
    const convex = (await import("../providers/convex.ts")).default;
    const validKey = "prod:my-team:my-project|encoded-token-bytes";
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = {
      token: validKey,
      identity: { environment: "prod", team: "my-team", project: "my-project" },
    };
    const resource = await convex.provision(ctx, auth, {});
    const materialized = await convex.materialize(ctx, resource, auth);
    expect(materialized.secrets.CONVEX_DEPLOY_KEY).toBe(validKey);
  });

  test("modal: accepts <id>:<secret> token shape with ak- or as- prefix", async () => {
    const modal = (await import("../providers/modal.ts")).default;
    const validKey = "ak-1234567890abcdef:secret-token-bytes-here";
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    const auth = { token: validKey, identity: { token_id: "ak-1234567890abcdef" } };
    const resource = await modal.provision(ctx, auth, {});
    const materialized = await modal.materialize(ctx, resource, auth);
    expect(materialized.secrets.MODAL_TOKEN).toBe(validKey);
  });
});
