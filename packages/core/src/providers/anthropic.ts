import { makeApiKeyProvider } from "./_api-key.ts";
import { extractRateLimitMetrics, tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "ANTHROPIC_API_KEY";

export default makeApiKeyProvider({
  name: "anthropic",
  displayName: "Anthropic",
  category: "ai",
  docs: "https://docs.anthropic.com/en/api",
  secretName: SECRET,
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
  deprovision: {
    description:
      "Anthropic API keys must be revoked manually in the Anthropic Console. No automated cleanup is performed.",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.anthropic.com/v1/models",
        { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs, ...extractRateLimitMetrics(res.headers) };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
