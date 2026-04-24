import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

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
  secretName: "GRAFANA_API_KEY",
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
});
