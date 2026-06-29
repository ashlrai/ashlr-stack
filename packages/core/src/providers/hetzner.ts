import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "HETZNER_API_TOKEN";

export default makeApiKeyProvider({
  name: "hetzner",
  displayName: "Hetzner",
  category: "cloud",
  docs: "https://docs.hetzner.cloud/",
  secretName: SECRET,
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
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.hetzner.cloud/v1/locations",
        { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
