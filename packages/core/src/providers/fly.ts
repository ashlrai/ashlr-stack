import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "FLY_API_TOKEN";

const _base = makeApiKeyProvider({
  name: "fly",
  displayName: "Fly.io",
  category: "deploy",
  docs: "https://fly.io/docs/machines/api",
  secretName: SECRET,
  howTo: "Run `fly auth token` or create one at https://fly.io/user/personal_access_tokens",
  dashboard: "https://fly.io/dashboard",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.machines.dev/v1/apps", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { apps?: Array<{ name: string }> };
      return { apps: String(body.apps?.length ?? 0) };
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
        "https://api.machines.dev/v1/apps",
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
 * Fly.io deprovision — the v1 provision only attaches to the user's Fly.io
 * account (no app is auto-created). Deprovision validates the token is still
 * active, then is a no-op. Actual app deletion requires `flyctl apps destroy`
 * or the Fly Machines API with an explicit app name.
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new StackError("FLY_DEPROVISION_ABORTED", "Fly.io deprovision cancelled.");
  }
  // Validate the token is still working.
  try {
    const res = await verifyFetch("https://api.machines.dev/v1/apps", {
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: ctx.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new StackError(
        "FLY_DEPROVISION_FORBIDDEN",
        `Fly.io returned ${res.status} validating token for resource ${resourceId}. ` +
          `Check your token at https://fly.io/user/personal_access_tokens.`,
      );
    }
    if (!res.ok) {
      throw new StackError(
        "FLY_DEPROVISION_FAILED",
        `Fly.io returned ${res.status} validating resource ${resourceId}. ` +
          `Delete manually at https://fly.io/dashboard.`,
      );
    }
  } catch (err) {
    if (err instanceof StackError) throw err;
    throw new StackError(
      "FLY_DEPROVISION_FAILED",
      `Fly.io deprovision failed for ${resourceId}: ${(err as Error).message}. ` +
        `Delete manually at https://fly.io/dashboard.`,
    );
  }
  // Account attachment only — no upstream resource to delete.
}

export default { ..._base, deprovision };
