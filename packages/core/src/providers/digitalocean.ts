import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "DIGITALOCEAN_TOKEN";

export default makeApiKeyProvider({
  name: "digitalocean",
  displayName: "DigitalOcean",
  category: "cloud",
  docs: "https://docs.digitalocean.com/reference/api/api-reference/",
  secretName: SECRET,
  howTo: "Create a personal access token at https://cloud.digitalocean.com/account/api/tokens.",
  dashboard: "https://cloud.digitalocean.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.digitalocean.com/v2/account", {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { account?: { email?: string; uuid?: string } };
      return {
        email: body.account?.email ?? "",
        uuid: body.account?.uuid ?? "",
      };
    } catch {
      return undefined;
    }
  },
  deprovision: {
    description:
      "DigitalOcean personal access tokens must be revoked manually at https://cloud.digitalocean.com/account/api/tokens.",
    docsUrl: "https://cloud.digitalocean.com/account/api/tokens",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.digitalocean.com/v2/account",
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
