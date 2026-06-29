import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "MAILGUN_API_KEY";

// Mailgun's API uses HTTP Basic auth with the literal username `api` and the
// API key as password, not a bearer token — hence the inlined base64 header.
export default makeApiKeyProvider({
  name: "mailgun",
  displayName: "Mailgun",
  category: "email",
  docs: "https://documentation.mailgun.com/docs/mailgun/api-reference/",
  secretName: SECRET,
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
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.mailgun.net/v3/domains",
        { headers: { Authorization: `Basic ${btoa(`api:${key}`)}` }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
