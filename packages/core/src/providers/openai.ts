import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "openai",
  displayName: "OpenAI",
  category: "ai",
  docs: "https://platform.openai.com/docs/api-reference",
  secretName: "OPENAI_API_KEY",
  howTo: "Create a key at https://platform.openai.com/api-keys",
  dashboard: "https://platform.openai.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.openai.com/v1/models", {
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
