import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "REPLICATE_API_TOKEN";

/**
 * Replicate — run open-source ML models via API. v1 accepts a Replicate API
 * token (users create at https://replicate.com/account/api-tokens) and
 * verifies via a GET /account call.
 */
export default makeApiKeyProvider({
  name: "replicate",
  displayName: "Replicate",
  category: "ai",
  docs: "https://replicate.com/docs/reference/http",
  secretName: SECRET,
  howTo: "Create a token at https://replicate.com/account/api-tokens",
  dashboard: "https://replicate.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.replicate.com/v1/account", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { username?: string; type?: string };
      if (!body.username) return undefined;
      return { username: body.username, type: body.type ?? "" };
    } catch {
      return undefined;
    }
  },
  deprovision: {
    description:
      "Replicate API tokens must be revoked manually at https://replicate.com/account/api-tokens.",
    docsUrl: "https://replicate.com/docs/reference/http#authentication",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.replicate.com/v1/account",
        { headers: { Authorization: `Bearer ${key}` }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
