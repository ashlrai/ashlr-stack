import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "hetzner",
  displayName: "Hetzner",
  category: "cloud",
  docs: "https://docs.hetzner.cloud/",
  secretName: "HETZNER_API_TOKEN",
  howTo: "Create an API token in Hetzner Cloud Console → Project → Security → API Tokens.",
  dashboard: "https://console.hetzner.cloud",
  async verify(key) {
    try {
      // GET /v1/locations is a lightweight public-ish endpoint that returns
      // available datacenters — valid for any token, no side effects.
      const res = await verifyFetch("https://api.hetzner.cloud/v1/locations", {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { locations?: Array<{ name: string }> };
      return { locations: String(body.locations?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
});
