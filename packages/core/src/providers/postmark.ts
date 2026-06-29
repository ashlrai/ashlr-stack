import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "POSTMARK_ACCOUNT_TOKEN";

export default makeApiKeyProvider({
  name: "postmark",
  displayName: "Postmark",
  category: "email",
  docs: "https://postmarkapp.com/developer/api/overview",
  secretName: SECRET,
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
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.postmarkapp.com/servers",
        { headers: { "X-Postmark-Account-Token": key, Accept: "application/json" }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
