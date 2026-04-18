import { makeApiKeyProvider } from "./_api-key.ts";

/**
 * Replicate — run open-source ML models via API. v1 accepts a Replicate API
 * token (users create at https://replicate.com/account/api-tokens) and
 * verifies via a GET /account call.
 */
export default makeApiKeyProvider({
  name: "replicate",
  displayName: "Replicate",
  category: "ai",
  docs: "https://replicate.com/docs/reference/http",
  secretName: "REPLICATE_API_TOKEN",
  howTo: "Create a token at https://replicate.com/account/api-tokens",
  dashboard: "https://replicate.com",
  async verify(key) {
    try {
      const res = await fetch("https://api.replicate.com/v1/account", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { username?: string; type?: string };
      if (!body.username) return undefined;
      return { username: body.username, type: body.type ?? "" };
    } catch {
      return undefined;
    }
  },
});
