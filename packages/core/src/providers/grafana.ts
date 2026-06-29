import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "GRAFANA_API_KEY";
const URL_SECRET = "GRAFANA_URL";

// Grafana is self-hosted or Grafana Cloud — we store both the token and the
// base URL. The secretName for `makeApiKeyProvider` is the token slot; the URL
// is prompted separately in the howTo message and stored via a custom
// materialize approach. For now, the key that is "verified" is the API token,
// and the GRAFANA_URL is a second secret the user must add manually or via
// `stack add grafana` with a follow-up prompt. This matches the pattern used
// by Sentry (which also stores multiple secrets).
export default makeApiKeyProvider({
  name: "grafana",
  displayName: "Grafana",
  category: "observability",
  docs: "https://grafana.com/docs/grafana/latest/developers/http_api/",
  secretName: SECRET,
  howTo:
    "Create a service-account token in Grafana → Administration → Service accounts. You will also need your Grafana base URL (e.g. https://myorg.grafana.net).",
  dashboard: "https://grafana.com",
  async verify(key) {
    // Without the URL we can't verify against the actual instance. We do a
    // structural check: Grafana service-account tokens start with "glsa_".
    // Grafana Cloud API tokens also start with "glc_". Accept both shapes.
    if (key.startsWith("glsa_") || key.startsWith("glc_") || key.length >= 32) {
      return { token_type: key.startsWith("glsa_") ? "service_account" : "api_key" };
    }
    return undefined;
  },
  deprovision: {
    description:
      "Grafana service-account tokens must be revoked manually in Grafana → Administration → Service accounts.",
    docsUrl: "https://grafana.com/docs/grafana/latest/administration/service-accounts/",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const grafanaUrl = await tryRevealSecret(URL_SECRET);
    // If we have a URL, do a real liveness check against the instance health endpoint.
    if (grafanaUrl) {
      const start = Date.now();
      try {
        const res = await verifyFetch(
          `${grafanaUrl.replace(/\/$/, "")}/api/health`,
          { headers: { Authorization: `Bearer ${key}` }, signal: ctx.signal },
        );
        const latencyMs = Date.now() - start;
        if (res.ok) return { kind: "ok", latencyMs };
        return { kind: "error", detail: `HTTP ${res.status}` };
      } catch (err) {
        return { kind: "error", detail: (err as Error).message };
      }
    }
    // No URL stored — fall back to structural token shape check.
    const start = Date.now();
    const isValid = key.startsWith("glsa_") || key.startsWith("glc_") || key.length >= 32;
    const latencyMs = Date.now() - start;
    return isValid
      ? { kind: "ok", latencyMs, detail: "structural check only — set GRAFANA_URL for live check" }
      : { kind: "error", detail: "token does not match expected Grafana token shape" };
  },
});
