import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "DEEPSEEK_API_KEY";

export default makeApiKeyProvider({
  name: "deepseek",
  displayName: "DeepSeek",
  category: "ai",
  docs: "https://api-docs.deepseek.com",
  secretName: SECRET,
  howTo: "Create a key at https://platform.deepseek.com/api_keys",
  dashboard: "https://platform.deepseek.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.deepseek.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return { models: String(body.data?.length ?? 0) };
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
        "https://api.deepseek.com/v1/models",
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
