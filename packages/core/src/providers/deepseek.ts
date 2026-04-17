import { makeApiKeyProvider } from "./_api-key.ts";

export default makeApiKeyProvider({
  name: "deepseek",
  displayName: "DeepSeek",
  category: "ai",
  docs: "https://api-docs.deepseek.com",
  secretName: "DEEPSEEK_API_KEY",
  howTo: "Create a key at https://platform.deepseek.com/api_keys",
  dashboard: "https://platform.deepseek.com",
  async verify(key) {
    try {
      const res = await fetch("https://api.deepseek.com/v1/models", {
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
