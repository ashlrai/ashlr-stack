import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "fly",
  displayName: "Fly.io",
  category: "deploy",
  docs: "https://fly.io/docs/machines/api",
  secretName: "FLY_API_TOKEN",
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
});
