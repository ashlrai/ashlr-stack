import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "xai",
  displayName: "xAI",
  category: "ai",
  docs: "https://docs.x.ai/api",
  secretName: "XAI_API_KEY",
  howTo: "Create a key at https://console.x.ai",
  dashboard: "https://console.x.ai",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return { models: String(body.data?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
});
