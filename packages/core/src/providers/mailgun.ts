import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

// Mailgun's API uses HTTP Basic auth with the literal username `api` and the
// API key as password, not a bearer token — hence the inlined base64 header.
export default makeApiKeyProvider({
  name: "mailgun",
  displayName: "Mailgun",
  category: "email",
  docs: "https://documentation.mailgun.com/docs/mailgun/api-reference/",
  secretName: "MAILGUN_API_KEY",
  howTo: "Paste an API key from https://app.mailgun.com/settings/api_security.",
  dashboard: "https://app.mailgun.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.mailgun.net/v3/domains", {
        headers: { Authorization: `Basic ${btoa(`api:${key}`)}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { items?: Array<{ name: string }> };
      return { domains: String(body.items?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
});
