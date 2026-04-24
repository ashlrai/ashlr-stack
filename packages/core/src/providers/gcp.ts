import { makeApiKeyProvider } from "./_api-key.ts";

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
  secretName: "GCP_SERVICE_ACCOUNT_JSON",
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
});
