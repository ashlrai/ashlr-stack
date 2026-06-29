import { StackError } from "../errors.ts";
import type { AuthHandle, ProviderContext } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "RENDER_API_KEY";

/**
 * Render — managed deploys for web services, static sites, private services.
 * v1 accepts a user API key (create at https://dashboard.render.com/u/settings).
 * Verification hits /v1/owners.
 */
const _base = makeApiKeyProvider({
  name: "render",
  displayName: "Render",
  category: "deploy",
  docs: "https://api-docs.render.com",
  secretName: SECRET,
  howTo: "Create an API key at https://dashboard.render.com/u/settings",
  dashboard: "https://dashboard.render.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.render.com/v1/owners", {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as Array<{ owner?: { id?: string; name?: string } }>;
      const first = body[0]?.owner;
      if (!first?.id) return undefined;
      return { id: first.id, name: first.name ?? "" };
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
        "https://api.render.com/v1/owners",
        { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: ctx.signal },
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
 * Render deprovision — deletes a service (web service, private service, etc.)
 * created during provision. resourceId is the Render service id (e.g. "srv-…").
 * Idempotent: 404 is treated as success (already deleted).
 */
async function deprovision(
  ctx: ProviderContext,
  auth: AuthHandle,
  resourceId: string,
): Promise<void> {
  try {
    const res = await fetch(`https://api.render.com/v1/services/${resourceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
      signal: ctx.signal,
    });
    if (res.status === 404) return; // already gone — idempotent
    if (!res.ok) {
      ctx.log({
        level: "warn",
        msg: `Render deprovision returned ${res.status} for service ${resourceId}; resource may need manual cleanup at https://dashboard.render.com.`,
      });
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new StackError("RENDER_DEPROVISION_ABORTED", "Render deprovision cancelled.");
    }
    ctx.log({
      level: "warn",
      msg: `Render deprovision failed for ${resourceId}: ${(err as Error).message}. Resource may need manual cleanup at https://dashboard.render.com.`,
    });
  }
}

export default { ..._base, deprovision };
