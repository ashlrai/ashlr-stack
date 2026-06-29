import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "PLAUSIBLE_API_KEY";

export default makeApiKeyProvider({
  name: "plausible",
  displayName: "Plausible",
  category: "analytics",
  docs: "https://plausible.io/docs/stats-api",
  secretName: SECRET,
  howTo:
    "Generate an API key at https://plausible.io/settings and note your site ID (the domain you track).",
  dashboard: "https://plausible.io",
  async verify(key) {
    try {
      // /api/v1/sites lists all sites — read-only, confirms key validity.
      const res = await verifyFetch("https://plausible.io/api/v1/sites", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { sites?: Array<{ domain: string }> };
      return { sites: String(body.sites?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
  deprovision: {
    description:
      "Plausible API keys must be revoked manually at https://plausible.io/settings.",
    docsUrl: "https://plausible.io/docs/stats-api",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://plausible.io/api/v1/sites",
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
