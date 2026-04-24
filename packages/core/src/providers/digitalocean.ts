import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "digitalocean",
  displayName: "DigitalOcean",
  category: "cloud",
  docs: "https://docs.digitalocean.com/reference/api/api-reference/",
  secretName: "DIGITALOCEAN_TOKEN",
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
});
