import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "WORKOS_API_KEY";

export default makeApiKeyProvider({
  name: "workos",
  displayName: "WorkOS",
  category: "auth",
  docs: "https://workos.com/docs/reference/api",
  secretName: SECRET,
  howTo: "Find your API key in the WorkOS dashboard → API Keys.",
  dashboard: "https://dashboard.workos.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.workos.com/organizations?limit=1", {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: unknown[] };
      return { organizations: String(body.data?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
  deprovision: {
    description:
      "WorkOS API keys must be revoked manually in the WorkOS dashboard → API Keys.",
    docsUrl: "https://workos.com/docs/reference/api",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.workos.com/organizations?limit=1",
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
