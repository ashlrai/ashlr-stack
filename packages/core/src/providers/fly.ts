import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "FLY_API_TOKEN";

export default makeApiKeyProvider({
  name: "fly",
  displayName: "Fly.io",
  category: "deploy",
  docs: "https://fly.io/docs/machines/api",
  secretName: SECRET,
  howTo: "Run `fly auth token` or create one at https://fly.io/user/personal_access_tokens",
  dashboard: "https://fly.io/dashboard",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.machines.dev/v1/apps", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { apps?: Array<{ name: string }> };
      return { apps: String(body.apps?.length ?? 0) };
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
        "https://api.machines.dev/v1/apps",
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
