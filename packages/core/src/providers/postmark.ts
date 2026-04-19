import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "postmark",
  displayName: "Postmark",
  category: "email",
  docs: "https://postmarkapp.com/developer/api/overview",
  secretName: "POSTMARK_ACCOUNT_TOKEN",
  howTo: "Paste an account token from https://account.postmarkapp.com/api_tokens.",
  dashboard: "https://account.postmarkapp.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.postmarkapp.com/servers", {
        headers: {
          "X-Postmark-Account-Token": key,
          Accept: "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { Servers?: Array<{ ID: number }> };
      return { servers: String(body.Servers?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
});
