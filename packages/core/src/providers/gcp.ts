import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret } from "./_helpers.ts";

const SECRET = "GCP_SERVICE_ACCOUNT_JSON";

// GCP uses a service-account JSON blob as the primary credential. We store
// the raw JSON in Phantom. The verify step does a structural parse only —
// exchanging the JSON for an OAuth2 access token and then calling the Cloud
// Resource Manager API requires network round-trips to token.googleapis.com
// and is deferred to v0.2. The structural check is sufficient to catch copy-
// paste errors (wrong file, truncated JSON, wrong project).
const _base = makeApiKeyProvider({
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

/**
 * GCP deprovision — the v1 provision only stores a service-account JSON
 * (no GCP project or resource is created by Stack). Deprovision validates
 * the stored JSON is structurally sound, then is a no-op. Actual project
 * deletion must be done via the GCP console or `gcloud` CLI.
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new StackError("GCP_DEPROVISION_ABORTED", "GCP deprovision cancelled.");
  }
  try {
    const parsed = JSON.parse(auth.token) as Record<string, unknown>;
    if (
      parsed.type !== "service_account" ||
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string"
    ) {
      throw new StackError(
        "GCP_DEPROVISION_FAILED",
        `GCP service-account JSON for resource ${resourceId} is malformed. ` +
          `Delete the project manually at https://console.cloud.google.com.`,
      );
    }
  } catch (err) {
    if (err instanceof StackError) throw err;
    throw new StackError(
      "GCP_DEPROVISION_FAILED",
      `GCP deprovision failed parsing credentials for ${resourceId}: ${(err as Error).message}. ` +
        `Delete manually at https://console.cloud.google.com.`,
    );
  }
  // Service-account attachment only — no upstream resource created by Stack.
}

export default { ..._base, deprovision };
