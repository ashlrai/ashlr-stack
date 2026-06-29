import { StackError } from "../errors.ts";
import type { AuthHandle, ConflictCheckOpts, ProviderContext, ResourceConflictCheckConfig } from "./_base.ts";
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

/**
 * Render conflict check — lists services under the first owner (account/team)
 * and checks whether a service with the requested name already exists.
 */
async function checkConflict(
  auth: AuthHandle,
  opts: ConflictCheckOpts,
): Promise<ResourceConflictCheckConfig> {
  const now = new Date().toISOString();
  const desiredName = opts.desiredName;
  try {
    if (!desiredName) {
      return {
        requestedName: "(auto)",
        exists: false,
        action: "ok",
        message: "No desired name specified; auto-naming will avoid conflicts.",
        checkedAt: now,
      };
    }
    const res = await verifyFetch(
      `https://api.render.com/v1/services?limit=100&name=${encodeURIComponent(desiredName)}`,
      {
        headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    );
    if (!res.ok) {
      return {
        requestedName: desiredName,
        exists: undefined,
        action: "unreachable",
        message: `Render API returned ${res.status} during conflict check; proceeding with provision.`,
        checkedAt: now,
      };
    }
    const body = (await res.json()) as Array<{ service?: { id?: string; name?: string } }>;
    const match = body.find((item) => item.service?.name === desiredName)?.service;
    if (!match) {
      return {
        requestedName: desiredName,
        exists: false,
        action: "ok",
        message: `No Render service named "${desiredName}" found; safe to create.`,
        checkedAt: now,
      };
    }
    const suffix = Date.now().toString(36);
    return {
      requestedName: desiredName,
      exists: true,
      existingResourceId: match.id,
      existingDisplayName: match.name,
      suggestedUniqueName: `${desiredName}-${suffix}`,
      action: "rename",
      message: `A Render service named "${desiredName}" already exists (id: ${match.id}). You can attach to it or use a unique name.`,
      checkedAt: now,
    };
  } catch {
    return {
      requestedName: desiredName ?? "(auto)",
      exists: undefined,
      action: "unreachable",
      message: "Render API unreachable during conflict check; proceeding with provision.",
      checkedAt: now,
    };
  }
}

export default { ..._base, deprovision, checkConflict };
