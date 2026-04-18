import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "posthog",
  displayName: "PostHog",
  category: "analytics",
  docs: "https://posthog.com/docs/api",
  secretName: "POSTHOG_PERSONAL_API_KEY",
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
});
