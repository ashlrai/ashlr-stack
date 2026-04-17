import { makeApiKeyProvider } from "./_api-key.ts";

/**
 * Firebase — v1 accepts a service-account JSON (users download from
 * https://console.firebase.google.com → Project Settings → Service Accounts
 * → Generate new private key). We store the entire JSON blob as a single
 * secret and shape-check it has the fields Firebase SDKs need.
 */
export default makeApiKeyProvider({
  name: "firebase",
  displayName: "Firebase",
  category: "database",
  docs: "https://firebase.google.com/docs/admin/setup",
  secretName: "FIREBASE_SERVICE_ACCOUNT_JSON",
  howTo:
    "Download a Service Account JSON at https://console.firebase.google.com → Settings → Service Accounts",
  dashboard: "https://console.firebase.google.com",
  async verify(blob) {
    try {
      const parsed = JSON.parse(blob) as {
        type?: string;
        project_id?: string;
        client_email?: string;
      };
      if (parsed.type !== "service_account") return undefined;
      if (!parsed.project_id || !parsed.client_email) return undefined;
      return {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
      };
    } catch {
      return undefined;
    }
  },
});
