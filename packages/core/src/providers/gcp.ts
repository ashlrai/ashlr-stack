import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret } from "./_helpers.ts";

const SECRET = "GCP_SERVICE_ACCOUNT_JSON";

// GCP uses a service-account JSON blob as the primary credential. We store
// the raw JSON in Phantom. The verify step does a structural parse only —
// exchanging the JSON for an OAuth2 access token and then calling the Cloud
// Resource Manager API requires network round-trips to token.googleapis.com
// and is deferred to v0.2. The structural check is sufficient to catch copy-
// paste errors (wrong file, truncated JSON, wrong project).
export default makeApiKeyProvider({
  name: "gcp",
  displayName: "GCP",
  category: "cloud",
  docs: "https://cloud.google.com/docs/authentication/getting-started",
  secretName: SECRET,
  howTo:
    "Download a service-account JSON key from GCP → IAM & Admin → Service Accounts and paste the full JSON content.",
  dashboard: "https://console.cloud.google.com",
  async verify(key) {
    try {
      const parsed = JSON.parse(key) as Record<string, unknown>;
      if (
        parsed.type === "service_account" &&
        typeof parsed.project_id === "string" &&
        typeof parsed.client_email === "string"
      ) {
        return {
          project_id: parsed.project_id as string,
          client_email: parsed.client_email as string,
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  },
  async healthcheck(_ctx) {
    // Structural healthcheck: confirm the service-account JSON is still present
    // and well-formed. A network token exchange is deferred to v0.2.
    const blob = await tryRevealSecret(SECRET);
    if (!blob) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const parsed = JSON.parse(blob) as Record<string, unknown>;
      const latencyMs = Date.now() - start;
      if (
        parsed.type === "service_account" &&
        typeof parsed.project_id === "string" &&
        typeof parsed.client_email === "string"
      ) {
        return { kind: "ok", latencyMs, detail: `project_id=${parsed.project_id}` };
      }
      return { kind: "error", detail: "service account JSON is malformed or missing required fields" };
    } catch {
      return { kind: "error", detail: "service account JSON failed to parse" };
    }
  },
});
