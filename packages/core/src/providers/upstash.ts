import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "UPSTASH_MANAGEMENT_TOKEN";

/**
 * Upstash uses HTTP Basic auth with email + Management API key. For v1 we
 * accept a single pasted string in the form "email:token" which becomes the
 * base64 Authorization header. Thicker provisioning (create Redis / Kafka /
 * QStash) lands in a future wave.
 */
const _base = makeApiKeyProvider({
  name: "upstash",
  displayName: "Upstash",
  category: "database",
  docs: "https://upstash.com/docs/devops/developer-api",
  secretName: SECRET,
  howTo:
    "Grab a Management API key at https://console.upstash.com/account/api; paste as email:token",
  dashboard: "https://console.upstash.com",
  async verify(key) {
    try {
      const basic = Buffer.from(key).toString("base64");
      const res = await verifyFetch("https://api.upstash.com/v2/redis/databases", {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as unknown[];
      return { databases: String(Array.isArray(body) ? body.length : 0) };
    } catch {
      return undefined;
    }
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const basic = Buffer.from(key).toString("base64");
      const res = await verifyFetch(
        "https://api.upstash.com/v2/redis/databases",
        { headers: { Authorization: `Basic ${basic}` }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});

/**
 * Upstash deprovision — the v1 provision only stores an API credential (no
 * Redis / Kafka / QStash database is auto-created). Deprovision validates the
 * credential is still active, then is a no-op. Actual database deletion must
 * be done via the Upstash console or Management API with an explicit database id.
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new StackError("UPSTASH_DEPROVISION_ABORTED", "Upstash deprovision cancelled.");
  }
  try {
    const basic = Buffer.from(auth.token).toString("base64");
    const res = await verifyFetch("https://api.upstash.com/v2/redis/databases", {
      headers: { Authorization: `Basic ${basic}` },
      signal: ctx.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new StackError(
        "UPSTASH_DEPROVISION_FORBIDDEN",
        `Upstash returned ${res.status} validating credentials for resource ${resourceId}. ` +
          `Check your Management API key at https://console.upstash.com/account/api.`,
      );
    }
    if (!res.ok) {
      throw new StackError(
        "UPSTASH_DEPROVISION_FAILED",
        `Upstash returned ${res.status} validating resource ${resourceId}. ` +
          `Delete manually at https://console.upstash.com.`,
      );
    }
  } catch (err) {
    if (err instanceof StackError) throw err;
    throw new StackError(
      "UPSTASH_DEPROVISION_FAILED",
      `Upstash deprovision failed for ${resourceId}: ${(err as Error).message}. ` +
        `Delete manually at https://console.upstash.com.`,
    );
  }
  // Credential attachment only — no upstream resource created by Stack.
}

export default { ..._base, deprovision };
