import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

/**
 * Stripe — v1 uses a restricted secret key (users create at
 * https://dashboard.stripe.com/apikeys). Full Stripe Connect / account
 * linking lands when we register the Ashlr Stack OAuth app with Stripe.
 */
export default makeApiKeyProvider({
  name: "stripe",
  displayName: "Stripe",
  category: "payments",
  docs: "https://docs.stripe.com/api",
  secretName: "STRIPE_SECRET_KEY",
  howTo:
    "Create a restricted key at https://dashboard.stripe.com/apikeys (use test mode for development)",
  dashboard: "https://dashboard.stripe.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(body))
        if (typeof v === "string") out[k] = v;
      return out;
    } catch {
      return undefined;
    }
  },
});
