import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { addSecret } from "../phantom.ts";
import { fetchWithRetry } from "../http.ts";
import { readLine, tryRevealSecret } from "./_helpers.ts";
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
 * Neon — serverless Postgres. v1 uses a Neon API key (users create one at
 * https://console.neon.tech/app/settings/api-keys). Provision creates a new
 * project (and thus a default branch + database + role), materialize returns
 * the connection string.
 *
 * API reference: https://api-docs.neon.tech/reference/getting-started-with-neon-api
 */

const API = "https://console.neon.tech/api/v2";
const TOKEN_SECRET = "NEON_API_KEY";

const neon: Provider = {
  name: "neon",
  displayName: "Neon",
  category: "database",
  authKind: "pat",
  docs: "https://neon.tech/docs/reference/api-reference",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const cached = await tryRevealSecret(TOKEN_SECRET);
    if (cached) {
      const identity = await fetchIdentity(cached);
      if (identity) return { token: cached, identity };
      ctx.log({ level: "warn", msg: "Cached Neon key invalid; re-entering." });
    }
    if (!ctx.interactive) throw new StackError("NEON_AUTH_REQUIRED", "No valid Neon API key in vault.");
    process.stderr.write(
      "\n  Create a Neon API key at https://console.neon.tech/app/settings/api-keys\n  Paste it here: ",
    );
    const token = (await readLine()).trim();
    const identity = await fetchIdentity(token);
    if (!identity) throw new StackError("NEON_AUTH_INVALID", "Neon rejected that API key.");
    await addSecret(TOKEN_SECRET, token);
    return { token, identity };
  },

  async provision(_ctx, auth, opts: ProvisionOpts): Promise<Resource> {
    if (opts.existingResourceId) {
      const project = await fetchProject(auth.token, opts.existingResourceId);
      if (!project)
        throw new StackError("NEON_PROJECT_NOT_FOUND", `No Neon project ${opts.existingResourceId}.`);
      return toResource(project);
    }
    const name = `stack-${Date.now().toString(36)}`;
    const region = (opts.hints?.region as string | undefined) ?? "aws-us-east-2";
    const res = await fetch(`${API}/projects`, {
      method: "POST",
      headers: authHeaders(auth.token),
      body: JSON.stringify({ project: { name, region_id: region } }),
    });
    if (!res.ok)
      throw new StackError(
        "NEON_CREATE_FAILED",
        `Neon project creation failed (${res.status}): ${await res.text()}`,
      );
    const body = (await res.json()) as { project: NeonProject; connection_uris?: Array<{ connection_uri: string }> };
    // Stash the fresh connection URI keyed by project id so it isn't confused
    // with another project's DATABASE_URL. Also write the canonical slot (the
    // current project's materialize call will overwrite it).
    if (body.connection_uris?.[0]?.connection_uri) {
      const uri = body.connection_uris[0].connection_uri;
      await addSecret(`NEON_DATABASE_URL_${body.project.id}`, uri);
      await addSecret("DATABASE_URL", uri);
    }
    return toResource(body.project);
  },

  async materialize(_ctx, resource, auth): Promise<Materialized> {
    // Always fetch the connection URI from the API — the vault's DATABASE_URL
    // is a generic key that may belong to another project or another provider.
    // Don't trust it as a cache here.
    const connectionUri = await fetchConnectionUri(auth.token, resource.id);
    if (!connectionUri)
      throw new StackError(
        "NEON_CONNECTION_UNAVAILABLE",
        `Couldn't obtain a connection string for Neon project ${resource.id}.`,
      );
    return {
      secrets: {
        NEON_API_KEY: auth.token,
        DATABASE_URL: connectionUri,
      },
      urls: { dashboard: `https://console.neon.tech/app/projects/${resource.id}` },
    };
  },

  async healthcheck(_ctx, entry: ServiceEntry): Promise<HealthStatus> {
    const token = await tryRevealSecret(TOKEN_SECRET);
    if (!token) return { kind: "error", detail: `${TOKEN_SECRET} missing from vault` };
    if (!entry.resource_id) return { kind: "warn", detail: "no resource_id" };
    const start = Date.now();
    const project = await fetchProject(token, entry.resource_id);
    const latencyMs = Date.now() - start;
    return project ? { kind: "ok", latencyMs } : { kind: "error", detail: "project not found" };
  },

  dashboardUrl(entry: ServiceEntry): string {
    return entry.resource_id
      ? `https://console.neon.tech/app/projects/${entry.resource_id}`
      : "https://console.neon.tech";
  },
};

export default neon;

interface NeonProject {
  id: string;
  name: string;
  region_id: string;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
    Accept: "application/json",
  };
}

async function fetchIdentity(token: string): Promise<Record<string, string> | undefined> {
  try {
    // Idempotent GET — retry transient failures so a flaky Neon console
    // gateway doesn't force the user to re-paste their API key.
    const res = await fetchWithRetry(`${API}/users/me`, { headers: authHeaders(token) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}

async function fetchProject(token: string, id: string): Promise<NeonProject | undefined> {
  // Idempotent GET — healthcheck + doctor both call this on every loop.
  const res = await fetchWithRetry(`${API}/projects/${id}`, { headers: authHeaders(token) });
  if (res.status === 404) return undefined;
  if (!res.ok) return undefined;
  const body = (await res.json()) as { project: NeonProject };
  return body.project;
}

async function fetchConnectionUri(token: string, projectId: string): Promise<string | undefined> {
  // Idempotent GET — retry transient failures so healthcheck + materialize
  // don't flap on a single flaky Neon gateway response.
  const res = await fetchWithRetry(`${API}/projects/${projectId}/connection_uri`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { uri?: string };
  return body.uri;
}

function toResource(project: NeonProject): Resource {
  return { id: project.id, displayName: project.name, region: project.region_id };
}


