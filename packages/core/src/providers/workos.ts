import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "workos",
  displayName: "WorkOS",
  category: "auth",
  docs: "https://workos.com/docs/reference/api",
  secretName: "WORKOS_API_KEY",
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
});
