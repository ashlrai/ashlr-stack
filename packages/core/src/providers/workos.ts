import type { AuthHandle, ConflictCheckOpts, ResourceConflictCheckConfig } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "WORKOS_API_KEY";

/**
 * WorkOS conflict check — lists organizations and checks whether one with the
 * requested name already exists in the account.
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
    const res = await verifyFetch("https://api.workos.com/organizations?limit=100", {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) {
      return {
        requestedName: desiredName,
        exists: undefined,
        action: "unreachable",
        message: `WorkOS API returned ${res.status} during conflict check; proceeding with provision.`,
        checkedAt: now,
      };
    }
    const body = (await res.json()) as { data?: Array<{ id: string; name: string }> };
    const orgs = body.data ?? [];
    const match = orgs.find((o) => o.name === desiredName);
    if (!match) {
      return {
        requestedName: desiredName,
        exists: false,
        action: "ok",
        message: `No WorkOS organization named "${desiredName}" found; safe to create.`,
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
      action: "attach",
      message: `A WorkOS organization named "${desiredName}" already exists (id: ${match.id}). You can attach to it or use a unique name.`,
      checkedAt: now,
    };
  } catch {
    return {
      requestedName: desiredName ?? "(auto)",
      exists: undefined,
      action: "unreachable",
      message: "WorkOS API unreachable during conflict check; proceeding with provision.",
      checkedAt: now,
    };
  }
}

const _base = makeApiKeyProvider({
  name: "workos",
  displayName: "WorkOS",
  category: "auth",
  docs: "https://workos.com/docs/reference/api",
  secretName: SECRET,
  howTo: "Find your API key in the WorkOS dashboard → API Keys.",
  dashboard: "https://dashboard.workos.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.workos.com/organizations?limit=1", {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { data?: unknown[] };
      return { organizations: String(body.data?.length ?? 0) };
    } catch {
      return undefined;
    }
  },
  deprovision: {
    description:
      "WorkOS API keys must be revoked manually in the WorkOS dashboard → API Keys.",
    docsUrl: "https://workos.com/docs/reference/api",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.workos.com/organizations?limit=1",
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "error", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },
});

export default { ..._base, checkConflict };
