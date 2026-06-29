import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "CLERK_SECRET_KEY";

export default makeApiKeyProvider({
  name: "clerk",
  displayName: "Clerk",
  category: "auth",
  docs: "https://clerk.com/docs",
  secretName: SECRET,
  howTo: "Grab your secret key from https://dashboard.clerk.com → API Keys",
  dashboard: "https://dashboard.clerk.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.clerk.com/v1/jwks", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      return { verified: "true" };
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
        "https://api.clerk.com/v1/jwks",
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
