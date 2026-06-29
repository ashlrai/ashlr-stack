import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "POSTHOG_PERSONAL_API_KEY";

export default makeApiKeyProvider({
  name: "posthog",
  displayName: "PostHog",
  category: "analytics",
  docs: "https://posthog.com/docs/api",
  secretName: SECRET,
  howTo: "Create a personal API key at https://app.posthog.com/me/settings (scope: all)",
  dashboard: "https://app.posthog.com",
  mcp: {
    name: "posthog",
    type: "sse",
    url: "https://mcp.posthog.com/sse",
    headers: { Authorization: "Bearer $(phantom reveal POSTHOG_PERSONAL_API_KEY)" },
  },
  async verify(key) {
    try {
      const res = await verifyFetch("https://app.posthog.com/api/projects", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { results?: Array<{ id: number; name: string }> };
      return { projects: String(body.results?.length ?? 0) };
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
        "https://app.posthog.com/api/projects",
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
