import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "BRAINTRUST_API_KEY";

/**
 * Braintrust — LLM eval + observability. v1 accepts a Braintrust API key
 * (create at https://www.braintrust.dev/app/settings/api-keys) and verifies
 * via /v1/organization (hits `https://api.braintrust.dev`).
 */
export default makeApiKeyProvider({
  name: "braintrust",
  displayName: "Braintrust",
  category: "ai",
  docs: "https://www.braintrust.dev/docs",
  secretName: SECRET,
  howTo: "Create a key at https://www.braintrust.dev/app/settings/api-keys",
  dashboard: "https://www.braintrust.dev/app",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.braintrust.dev/v1/organization", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as {
        objects?: Array<{ id?: string; name?: string }>;
      };
      const first = body.objects?.[0];
      if (!first?.id) return undefined;
      return { id: first.id, name: first.name ?? "" };
    } catch {
      return undefined;
    }
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.braintrust.dev/v1/organization",
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
