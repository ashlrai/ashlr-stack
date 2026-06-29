import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret } from "./_helpers.ts";

const SECRET = "FIREBASE_SERVICE_ACCOUNT_JSON";

/**
 * Firebase — v1 accepts a service-account JSON (users download from
 * https://console.firebase.google.com → Project Settings → Service Accounts
 * → Generate new private key). We store the entire JSON blob as a single
 * secret and shape-check it has the fields Firebase SDKs need.
 */
const _base = makeApiKeyProvider({
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

/**
 * Firebase deprovision — the v1 provision only stores a service-account JSON
 * (no GCP project is created by Stack). Deprovision validates the stored JSON
 * is structurally sound, then is a no-op. Actual project deletion must be done
 * via the Firebase or GCP console.
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new StackError("FIREBASE_DEPROVISION_ABORTED", "Firebase deprovision cancelled.");
  }
  // Validate the service-account JSON stored in the token is still parseable.
  try {
    const parsed = JSON.parse(auth.token) as {
      type?: string;
      project_id?: string;
      client_email?: string;
    };
    if (parsed.type !== "service_account" || !parsed.project_id || !parsed.client_email) {
      throw new StackError(
        "FIREBASE_DEPROVISION_FAILED",
        `Firebase service-account JSON for resource ${resourceId} is malformed. ` +
          `Delete the project manually at https://console.firebase.google.com.`,
      );
    }
  } catch (err) {
    if (err instanceof StackError) throw err;
    throw new StackError(
      "FIREBASE_DEPROVISION_FAILED",
      `Firebase deprovision failed parsing credentials for ${resourceId}: ${(err as Error).message}. ` +
        `Delete manually at https://console.firebase.google.com.`,
    );
  }
  // Service-account attachment only — no upstream resource created by Stack.
}

export default { ..._base, deprovision };
