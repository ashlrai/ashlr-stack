import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "sendgrid",
  displayName: "SendGrid",
  category: "email",
  docs: "https://docs.sendgrid.com/api-reference",
  secretName: "SENDGRID_API_KEY",
  howTo: "Paste an API key from https://app.sendgrid.com/settings/api_keys.",
  dashboard: "https://app.sendgrid.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.sendgrid.com/v3/scopes", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { scopes?: string[] };
      return { scopes: String(body.scopes?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
});
