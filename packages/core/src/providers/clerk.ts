import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "CLERK_SECRET_KEY";

const _base = makeApiKeyProvider({
  name: "clerk",
  displayName: "Clerk",
  category: "auth",
  docs: "https://clerk.com/docs",
  secretName: SECRET,
  howTo: "Grab your secret key from https://dashboard.clerk.com → API Keys",
  dashboard: "https://dashboard.clerk.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.clerk.com/v1/jwks", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      return { verified: "true" };
    } catch {
      return undefined;
    }
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.clerk.com/v1/jwks",
        { headers: { Authorization: `Bearer ${key}` }, signal: ctx.signal },
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
 * Clerk deprovision — the v1 provision only stores an API key (no Clerk
 * application is auto-created by Stack). Deprovision validates the key is still
 * active, then is a no-op. Actual application deletion must be done via the
 * Clerk dashboard.
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new StackError("CLERK_DEPROVISION_ABORTED", "Clerk deprovision cancelled.");
  }
  try {
    const res = await verifyFetch("https://api.clerk.com/v1/jwks", {
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: ctx.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new StackError(
        "CLERK_DEPROVISION_FORBIDDEN",
        `Clerk returned ${res.status} validating token for resource ${resourceId}. ` +
          `Check your key at https://dashboard.clerk.com → API Keys.`,
      );
    }
    if (!res.ok) {
      throw new StackError(
        "CLERK_DEPROVISION_FAILED",
        `Clerk returned ${res.status} validating resource ${resourceId}. ` +
          `Delete manually at https://dashboard.clerk.com.`,
      );
    }
  } catch (err) {
    if (err instanceof StackError) throw err;
    throw new StackError(
      "CLERK_DEPROVISION_FAILED",
      `Clerk deprovision failed for ${resourceId}: ${(err as Error).message}. ` +
        `Delete manually at https://dashboard.clerk.com.`,
    );
  }
  // API-key attachment only — no upstream resource created by Stack.
}

export default { ..._base, deprovision };
