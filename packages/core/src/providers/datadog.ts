import { makeApiKeyProvider } from "./_api-key.ts";
import { verifyFetch } from "./_helpers.ts";

export default makeApiKeyProvider({
  name: "datadog",
  displayName: "Datadog",
  category: "observability",
  docs: "https://docs.datadoghq.com/api/latest/",
  secretName: "DD_API_KEY",
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
});
