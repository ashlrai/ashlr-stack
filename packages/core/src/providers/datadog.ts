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
  deprovision: {
    description:
      "Datadog API keys must be revoked manually at https://app.datadoghq.com/organization-settings/api-keys. " +
      "If a resource ID matching a Datadog integration handle is provided, Stack will attempt to delete it via the API.",
    docsUrl: "https://docs.datadoghq.com/api/latest/key-management/",
    async cleanup(ctx, auth, resourceId) {
      // Only attempt API cleanup when the resource ID looks like a Datadog
      // integration handle (e.g. "aws_account_123" or similar). Plain
      // "default" IDs (synthesised by makeApiKeyProvider for key-only flows)
      // are skipped gracefully.
      if (!resourceId || resourceId === "default" || !auth.token) return;
      // We need both DD-API-KEY and DD-APPLICATION-KEY to call the key-mgmt
      // endpoints. The stored token is only the API key; if we don't have an
      // app key we fall back to a no-op log.
      const appKey = (auth.identity?.app_key as string | undefined) ?? "";
      if (!appKey) {
        ctx.log({
          level: "info",
          msg: "datadog deprovision: no application key available — skipping remote key revocation",
          data: { resourceId, provider: "datadog" },
        });
        return;
      }
      try {
        const res = await fetch(
          `https://api.datadoghq.com/api/v2/api_keys/${encodeURIComponent(resourceId)}`,
          {
            method: "DELETE",
            headers: {
              "DD-API-KEY": auth.token,
              "DD-APPLICATION-KEY": appKey,
              Accept: "application/json",
            },
            signal: ctx.signal,
          },
        );
        if (res.status === 404 || res.status === 204 || res.status === 200) return;
        const body = await res.text();
        throw new (await import("../errors.ts")).StackError(
          "DATADOG_DEPROVISION_FAILED",
          `Datadog key deletion returned HTTP ${res.status}: ${body}`,
        );
      } catch (err) {
        if ((err as Error & { code?: string }).code === "DATADOG_DEPROVISION_FAILED") throw err;
        ctx.log({
          level: "warn",
          msg: `datadog deprovision: network error during cleanup — ${(err as Error).message}`,
          data: { resourceId, provider: "datadog" },
        });
      }
    },
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
