import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "anthropic",
  displayName: "Anthropic",
  category: "ai",
  docs: "https://docs.anthropic.com/en/api",
  secretName: "ANTHROPIC_API_KEY",
  howTo: "Create a key at https://console.anthropic.com/settings/keys",
  dashboard: "https://console.anthropic.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return { models: String(body.data?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
});
