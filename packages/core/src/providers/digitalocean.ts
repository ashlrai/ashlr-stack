import type { AuthHandle, ConflictCheckOpts, ResourceConflictCheckConfig } from "./_base.ts";
import { makeApiKeyProvider } from "./_api-key.ts";
import { tryRevealSecret, verifyFetch } from "./_helpers.ts";

const SECRET = "DIGITALOCEAN_TOKEN";

/**
 * DigitalOcean conflict check — lists App Platform apps and checks whether
 * one with the requested name already exists in the account.
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
    const res = await verifyFetch("https://api.digitalocean.com/v2/apps?page=1&per_page=200", {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/json",
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) {
      return {
        requestedName: desiredName,
        exists: undefined,
        action: "unreachable",
        message: `DigitalOcean API returned ${res.status} during conflict check; proceeding with provision.`,
        checkedAt: now,
      };
    }
    const body = (await res.json()) as {
      apps?: Array<{ id?: string; spec?: { name?: string } }>;
    };
    const apps = body.apps ?? [];
    const match = apps.find((a) => a.spec?.name === desiredName);
    if (!match) {
      return {
        requestedName: desiredName,
        exists: false,
        action: "ok",
        message: `No DigitalOcean app named "${desiredName}" found; safe to create.`,
        checkedAt: now,
      };
    }
    const suffix = Date.now().toString(36);
    return {
      requestedName: desiredName,
      exists: true,
      existingResourceId: match.id ?? desiredName,
      existingDisplayName: match.spec?.name ?? desiredName,
      suggestedUniqueName: `${desiredName}-${suffix}`,
      action: "rename",
      message: `A DigitalOcean app named "${desiredName}" already exists (id: ${match.id}). You can attach to it or use a unique name.`,
      checkedAt: now,
    };
  } catch {
    return {
      requestedName: desiredName ?? "(auto)",
      exists: undefined,
      action: "unreachable",
      message: "DigitalOcean API unreachable during conflict check; proceeding with provision.",
      checkedAt: now,
    };
  }
}

const _base = makeApiKeyProvider({
  name: "digitalocean",
  displayName: "DigitalOcean",
  category: "cloud",
  docs: "https://docs.digitalocean.com/reference/api/api-reference/",
  secretName: SECRET,
  howTo: "Create a personal access token at https://cloud.digitalocean.com/account/api/tokens.",
  dashboard: "https://cloud.digitalocean.com",
  async verify(key) {
    try {
      const res = await verifyFetch("https://api.digitalocean.com/v2/account", {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { account?: { email?: string; uuid?: string } };
      return {
        email: body.account?.email ?? "",
        uuid: body.account?.uuid ?? "",
      };
    } catch {
      return undefined;
    }
  },
  deprovision: {
    description:
      "DigitalOcean personal access tokens must be revoked manually at https://cloud.digitalocean.com/account/api/tokens.",
    docsUrl: "https://cloud.digitalocean.com/account/api/tokens",
  },
  async healthcheck(ctx) {
    const key = await tryRevealSecret(SECRET);
    if (!key) return { kind: "error", detail: `${SECRET} missing from vault` };
    const start = Date.now();
    try {
      const res = await verifyFetch(
        "https://api.digitalocean.com/v2/account",
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

export default { ..._base, checkConflict };
