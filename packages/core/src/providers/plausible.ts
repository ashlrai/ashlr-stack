import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "plausible",
  displayName: "Plausible",
  category: "analytics",
  docs: "https://plausible.io/docs/stats-api",
  secretName: "PLAUSIBLE_API_KEY",
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
});
