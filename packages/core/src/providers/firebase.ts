import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret } from "./_helpers.ts";

const SECRET = "FIREBASE_SERVICE_ACCOUNT_JSON";

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
  secretName: SECRET,
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
  async healthcheck(_ctx) {
    // Structural healthcheck: confirm the service-account JSON is still present
    // and well-formed. A live Firebase Admin SDK call would require the full
    // JWT exchange which pulls in a large dep — deferred to v0.2.
    const blob = await tryRevealSecret(SECRET);
    if (!blob) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const parsed = JSON.parse(blob) as {
        type?: string;
        project_id?: string;
        client_email?: string;
      };
      const latencyMs = Date.now() - start;
      if (parsed.type !== "service_account") {
        return { kind: "error", detail: "service account JSON has wrong type field" };
      }
      if (!parsed.project_id || !parsed.client_email) {
        return { kind: "error", detail: "service account JSON missing project_id or client_email" };
      }
      return { kind: "ok", latencyMs, detail: `project_id=${parsed.project_id}` };
    } catch {
      return { kind: "error", detail: "service account JSON failed to parse" };
    }
  },
});
