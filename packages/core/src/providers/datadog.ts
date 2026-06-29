import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "DD_API_KEY";

export default makeApiKeyProvider({
  name: "datadog",
  displayName: "Datadog",
  category: "observability",
  docs: "https://docs.datadoghq.com/api/latest/",
  secretName: SECRET,
  howTo:
    "Create an API key at https://app.datadoghq.com/organization-settings/api-keys and an Application key at https://app.datadoghq.com/organization-settings/application-keys.",
  dashboard: "https://app.datadoghq.com",
  async verify(key) {
    try {
      // GET /api/v1/validate — requires only the API key in the header.
      const res = await verifyFetch("https://api.datadoghq.com/api/v1/validate", {
        headers: {
          "DD-API-KEY": key,
          Accept: "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { valid?: boolean };
      return body.valid ? { valid: "true" } : undefined;
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
        "https://api.datadoghq.com/api/v1/validate",
        { headers: { "DD-API-KEY": key, Accept: "application/json" }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (!res.ok) return { kind: "error", detail: `HTTP ${res.status}` };
      const body = (await res.json()) as { valid?: boolean };
      return body.valid ? { kind: "ok", latencyMs } : { kind: "error", detail: "key invalid" };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});
