import { StackError } from "../errors.ts";
import { addSecret } from "../phantom.ts";
import type {
  AuthHandle,
  HealthStatus,
  Materialized,
  Provider,
  ProviderContext,
  ProvisionOpts,
  Resource,
} from "./_base.ts";
import { readLine, scrub, tryRevealSecret, verifyFetch } from "./_helpers.ts";

/**
 * Stripe provider — two modes:
 *
 *   stack add stripe
 *     Classic API-key paste. Validates sk_live_…/sk_test_… against
 *     /v1/account and stores it as STRIPE_SECRET_KEY.
 *
 *   stack add stripe --webhook-endpoint <url> [--events <e1,e2,...>]
 *     Also creates a webhook endpoint via /v1/webhook_endpoints, captures the
 *     signing secret (whsec_…), and stores:
 *       STRIPE_WEBHOOK_SECRET        — the signing secret
 *       STRIPE_WEBHOOK_ENDPOINT_ID   — so a future `stack rotate stripe` can
 *                                       update the same endpoint, not create
 *                                       a duplicate
 *
 *   Hints (passed via ProvisionOpts.hints from the CLI):
 *     webhookEndpoint   — HTTPS URL to register (activates webhook flow)
 *     events            — comma-separated event list; defaults to subscription lifecycle
 *     secretKeyFromVault — skip interactive paste, use existing STRIPE_SECRET_KEY
 */

const SECRET_KEY_NAME = "STRIPE_SECRET_KEY";
const WEBHOOK_SECRET_NAME = "STRIPE_WEBHOOK_SECRET";
const WEBHOOK_ENDPOINT_ID_NAME = "STRIPE_WEBHOOK_ENDPOINT_ID";

/**
 * Subscription-lifecycle events that almost every SaaS needs out of the box.
 * Operators can override via --events.
 */
export const DEFAULT_WEBHOOK_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.payment_failed",
];

interface StripeHints {
  webhookEndpoint?: string;
  events?: string;
  secretKeyFromVault?: boolean;
}

async function verifyKey(key: string): Promise<Record<string, string> | undefined> {
  try {
    const res = await verifyFetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}

export interface WebhookEndpointResponse {
  id: string;
  secret: string;
  url: string;
}

async function createWebhookEndpoint(
  secretKey: string,
  url: string,
  events: string[],
): Promise<WebhookEndpointResponse> {
  const body = new URLSearchParams();
  body.set("url", url);
  for (const ev of events) body.append("enabled_events[]", ev);
  // Pin to a specific Stripe API version for predictable response shapes.
  body.set("api_version", "2024-06-20");

  const res = await verifyFetch("https://api.stripe.com/v1/webhook_endpoints", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    const detail = errBody.error?.message ?? `HTTP ${res.status}`;
    throw new StackError(
      "STRIPE_WEBHOOK_CREATE_FAILED",
      `Stripe webhook creation failed: ${detail}`,
    );
  }

  return res.json() as Promise<WebhookEndpointResponse>;
}

const stripeProvider: Provider = {
  name: "stripe",
  displayName: "Stripe",
  category: "payments",
  authKind: "api_key",
  docs: "https://docs.stripe.com/api",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    // --secret-key-from-vault: bypass interactive paste when the key is already stored.
    const hints = ctx.hints as StripeHints | undefined;
    if (hints?.secretKeyFromVault) {
      const cached = await tryRevealSecret(SECRET_KEY_NAME);
      if (!cached) {
        throw new StackError(
          "STRIPE_AUTH_REQUIRED",
          `--secret-key-from-vault specified but ${SECRET_KEY_NAME} is not in the vault. Run \`stack add stripe\` first.`,
        );
      }
      const identity = await verifyKey(cached);
      if (!identity) {
        throw new StackError(
          "STRIPE_AUTH_INVALID",
          `${SECRET_KEY_NAME} in vault is invalid. Re-run \`stack add stripe\` to update it.`,
        );
      }
      return { token: cached, identity };
    }

    // Standard path: prefer the cached key when it still validates.
    const cached = await tryRevealSecret(SECRET_KEY_NAME);
    if (cached) {
      const identity = await verifyKey(cached);
      if (identity) return { token: cached, identity };
      ctx.log({ level: "warn", msg: "Cached Stripe key invalid; re-entering." });
    }

    if (!ctx.interactive) {
      throw new StackError(
        "STRIPE_AUTH_REQUIRED",
        "Stripe: no valid key in vault and session is non-interactive.",
      );
    }

    process.stderr.write(
      "\n  Create a restricted key at https://dashboard.stripe.com/apikeys\n  Paste your Stripe secret key (sk_live_… or sk_test_…): ",
    );
    const key = (await readLine()).trim();
    if (!key) throw new StackError("STRIPE_AUTH_REQUIRED", "No key provided.");

    const identity = await verifyKey(key);
    if (!identity) throw new StackError("STRIPE_AUTH_INVALID", "Stripe rejected that key.");

    // Persist immediately so a webhook-creation failure doesn't force a re-paste.
    await addSecret(SECRET_KEY_NAME, key);
    return { token: key, identity };
  },

  async provision(ctx: ProviderContext, auth: AuthHandle, opts: ProvisionOpts): Promise<Resource> {
    const hints = opts.hints as StripeHints | undefined;
    const webhookUrl = hints?.webhookEndpoint;

    if (!webhookUrl) {
      // Plain sk_… flow — no webhook provisioning, behave like makeApiKeyProvider.
      const id =
        opts.existingResourceId ??
        auth.identity?.id ??
        auth.identity?.org_id ??
        "default";
      return {
        id,
        displayName:
          (auth.identity?.name as string | undefined) ??
          (auth.identity?.email as string | undefined) ??
          "Stripe",
        meta: auth.identity,
      };
    }

    // Webhook flow — call Stripe to create the endpoint.
    const rawEvents = hints?.events;
    const events = rawEvents
      ? rawEvents
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : DEFAULT_WEBHOOK_EVENTS;

    ctx.log({
      level: "info",
      msg: `Creating Stripe webhook endpoint: ${webhookUrl} (${events.length} events)`,
    });

    const endpoint = await createWebhookEndpoint(auth.token, webhookUrl, events);

    ctx.log({
      level: "info",
      // scrub shows only the prefix (whsec_xxx…) — never the full secret.
      msg: `Webhook created: ${endpoint.id} · secret ${scrub(endpoint.secret, 4)}`,
    });

    return {
      id: endpoint.id,
      displayName: `Stripe webhook (${endpoint.id})`,
      meta: {
        webhookEndpointId: endpoint.id,
        webhookSecret: endpoint.secret,
        webhookUrl: endpoint.url,
      },
    };
  },

  async materialize(_ctx: ProviderContext, resource: Resource, auth: AuthHandle): Promise<Materialized> {
    // Always persist the secret key.
    await addSecret(SECRET_KEY_NAME, auth.token);
    const secrets: Record<string, string> = { [SECRET_KEY_NAME]: auth.token };

    const meta = resource.meta as
      | { webhookSecret?: string; webhookEndpointId?: string }
      | undefined;

    if (meta?.webhookSecret) {
      await addSecret(WEBHOOK_SECRET_NAME, meta.webhookSecret);
      secrets[WEBHOOK_SECRET_NAME] = meta.webhookSecret;
    }
    if (meta?.webhookEndpointId) {
      await addSecret(WEBHOOK_ENDPOINT_ID_NAME, meta.webhookEndpointId);
      secrets[WEBHOOK_ENDPOINT_ID_NAME] = meta.webhookEndpointId;
    }

    return { secrets };
  },

  async healthcheck(_ctx: ProviderContext): Promise<HealthStatus> {
    const key = await tryRevealSecret(SECRET_KEY_NAME);
    if (!key) return { kind: "error", detail: `${SECRET_KEY_NAME} missing from vault` };
    const start = Date.now();
    const identity = await verifyKey(key);
    const latencyMs = Date.now() - start;
    return identity ? { kind: "ok", latencyMs } : { kind: "error", detail: "key invalid" };
  },

  dashboardUrl() {
    return "https://dashboard.stripe.com";
  },
};

export default stripeProvider;

// Internal exports for unit tests only — not part of the public API.
export { verifyKey as _verifyKey, createWebhookEndpoint as _createWebhookEndpoint };
