import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "SENDGRID_API_KEY";

export default makeApiKeyProvider({
  name: "sendgrid",
  displayName: "SendGrid",
  category: "email",
  docs: "https://docs.sendgrid.com/api-reference",
  secretName: SECRET,
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
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.sendgrid.com/v3/scopes",
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
