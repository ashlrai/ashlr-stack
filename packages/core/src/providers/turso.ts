import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { fetchWithRetry } from "../http.ts";
import { addSecret, revealSecret } from "../phantom.ts";
import type {
  AuthHandle,
  HealthStatus,
  Materialized,
  Provider,
  ProviderContext,
  ProvisionOpts,
  Resource,
} from "./_base.ts";

/**
 * Turso — LibSQL-backed edge database. v1 uses a user-created Platform API
 * token (https://app.turso.tech/settings/api-tokens). Provision creates a new
 * database; materialize surfaces the URL + an auto-issued auth token.
 *
 * API reference: https://docs.turso.tech/api-reference/introduction
 */

const API = "https://api.turso.tech/v1";
const PLATFORM_TOKEN_SECRET = "TURSO_PLATFORM_TOKEN";

const turso: Provider = {
  name: "turso",
  displayName: "Turso",
  category: "database",
  authKind: "pat",
  docs: "https://docs.turso.tech",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const cached = await tryRevealSecret(PLATFORM_TOKEN_SECRET);
    if (cached) {
      const identity = await fetchIdentity(cached);
      if (identity) return { token: cached, identity };
      ctx.log({ level: "warn", msg: "Cached Turso token invalid." });
    }
    if (!ctx.interactive)
      throw new StackError("TURSO_AUTH_REQUIRED", "No valid Turso token in vault.");
    process.stderr.write(
      "\n  Create a Platform API token at https://app.turso.tech/settings/api-tokens\n  Paste it here: ",
    );
    const token = (await readLine()).trim();
    const identity = await fetchIdentity(token);
    if (!identity) throw new StackError("TURSO_AUTH_INVALID", "Turso rejected that token.");
    await addSecret(PLATFORM_TOKEN_SECRET, token);
    return { token, identity };
  },

  async provision(ctx, auth, opts: ProvisionOpts): Promise<Resource> {
    const orgs = await fetchOrganizations(auth.token);
    if (orgs.length === 0)
      throw new StackError("TURSO_NO_ORGS", "Turso returned no organizations.");
    const orgSlug = (opts.hints?.orgSlug as string | undefined) ?? orgs[0].slug;
    if (opts.existingResourceId) {
      const [existingOrg, dbName] = opts.existingResourceId.split("/");
      return {
        id: opts.existingResourceId,
        displayName: dbName,
        meta: { org_slug: existingOrg, db_name: dbName },
      };
    }
    const dbName = `stack-${Date.now().toString(36)}`;
    const group = (opts.hints?.group as string | undefined) ?? "default";
    const res = await fetch(`${API}/organizations/${orgSlug}/databases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: dbName, group }),
    });
    if (!res.ok)
      throw new StackError(
        "TURSO_CREATE_FAILED",
        `Turso DB creation failed (${res.status}): ${await res.text()}`,
      );
    const body = (await res.json()) as { database: { Name: string; Hostname: string } };
    ctx.log({ level: "info", msg: `Created Turso DB ${body.database.Name}.` });
    return {
      id: `${orgSlug}/${body.database.Name}`,
      displayName: body.database.Name,
      meta: {
        org_slug: orgSlug,
        db_name: body.database.Name,
        hostname: body.database.Hostname,
      },
    };
  },

  async materialize(_ctx, resource, auth): Promise<Materialized> {
    const [orgSlug, dbName] = resource.id.split("/");
    const dbToken = await mintDbToken(auth.token, orgSlug, dbName);
    const hostname =
      (resource.meta?.hostname as string | undefined) ?? `${dbName}-${orgSlug}.turso.io`;
    const libsqlUrl = `libsql://${hostname}`;
    return {
      secrets: {
        TURSO_DATABASE_URL: libsqlUrl,
        TURSO_AUTH_TOKEN: dbToken,
        TURSO_PLATFORM_TOKEN: auth.token,
      },
      urls: { dashboard: `https://app.turso.tech/${orgSlug}/databases/${dbName}` },
    };
  },

  async healthcheck(_ctx, entry: ServiceEntry): Promise<HealthStatus> {
    const token = await tryRevealSecret(PLATFORM_TOKEN_SECRET);
    if (!token) return { kind: "error", detail: `${PLATFORM_TOKEN_SECRET} missing` };
    if (!entry.resource_id) return { kind: "warn", detail: "no resource_id" };
    const [orgSlug, dbName] = entry.resource_id.split("/");
    const start = Date.now();
    // Idempotent GET — healthcheck loops on this.
    const res = await fetchWithRetry(`${API}/organizations/${orgSlug}/databases/${dbName}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latencyMs = Date.now() - start;
    return res.ok ? { kind: "ok", latencyMs } : { kind: "error", detail: `HTTP ${res.status}` };
  },

  dashboardUrl(entry: ServiceEntry): string {
    if (!entry.resource_id) return "https://app.turso.tech";
    const [orgSlug, dbName] = entry.resource_id.split("/");
    return `https://app.turso.tech/${orgSlug}/databases/${dbName}`;
  },

  async deprovision(ctx: ProviderContext, auth: AuthHandle, resourceId: string): Promise<void> {
    // resourceId is "orgSlug/dbName"
    const [orgSlug, dbName] = resourceId.split("/");
    if (!orgSlug || !dbName) {
      ctx.log({
        level: "warn",
        msg: `Turso deprovision: invalid resourceId format "${resourceId}". Expected "orgSlug/dbName".`,
      });
      return;
    }
    try {
      const res = await fetch(`${API}/organizations/${orgSlug}/databases/${dbName}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (res.status === 404) return; // already gone
      if (!res.ok) {
        ctx.log({
          level: "warn",
          msg: `Turso deprovision returned ${res.status} for ${resourceId}; resource may need manual cleanup.`,
        });
      }
    } catch (err) {
      ctx.log({
        level: "warn",
        msg: `Turso deprovision failed for ${resourceId}: ${(err as Error).message}. Resource may need manual cleanup.`,
      });
    }
  },
};

export default turso;

async function fetchIdentity(token: string): Promise<Record<string, string> | undefined> {
  try {
    // Idempotent GET — retry transient failures during token validation.
    const res = await fetchWithRetry(`${API}/auth/validate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}

async function fetchOrganizations(token: string): Promise<Array<{ slug: string; name: string }>> {
  // Idempotent GET — retry transient 429/5xx.
  const res = await fetchWithRetry(`${API}/organizations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return (await res.json()) as Array<{ slug: string; name: string }>;
}

async function mintDbToken(
  platformToken: string,
  orgSlug: string,
  dbName: string,
): Promise<string> {
  const res = await fetch(`${API}/organizations/${orgSlug}/databases/${dbName}/auth/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${platformToken}`, "content-type": "application/json" },
    body: JSON.stringify({ expiration: "never", authorization: "full-access" }),
  });
  if (!res.ok)
    throw new StackError(
      "TURSO_TOKEN_FAILED",
      `Turso token mint failed (${res.status}): ${await res.text()}`,
    );
  const body = (await res.json()) as { jwt: string };
  return body.jwt;
}

async function tryRevealSecret(key: string): Promise<string | undefined> {
  try {
    const v = await revealSecret(key);
    return v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes("\n")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.split("\n")[0]);
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
