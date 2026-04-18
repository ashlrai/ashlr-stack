import {
  type AuthHandle,
  type HealthStatus,
  type Materialized,
  type Provider,
  type ProviderContext,
  type ProvisionOpts,
  type Resource,
} from "./_base.ts";
import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { addSecret, exec as phantomExec } from "../phantom.ts";
import { readLine, tryRevealSecret } from "./_helpers.ts";
import { fetchWithRetry } from "../http.ts";
import { runPkceFlow } from "../oauth.ts";
import { resolveOAuthClientId } from "../env.ts";

/**
 * Supabase — the Wave 2 pilot provider. Proves the full loop:
 *   login (OAuth PKCE or PAT) → provision (create project via Management API)
 *   → materialize (fetch URL + anon key + service role key) → MCP wiring.
 *
 * Management API docs: https://supabase.com/docs/reference/api/introduction
 */

const API = "https://api.supabase.com";
const STACK_PAT_SECRET = "STACK_SUPABASE_ACCESS_TOKEN";

const supabase: Provider = {
  name: "supabase",
  displayName: "Supabase",
  category: "database",
  authKind: "oauth_pkce",
  docs: "https://supabase.com/docs/reference/api/introduction",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const clientId = resolveOAuthClientId("supabase", process.env.SUPABASE_STACK_CLIENT_ID);

    // Path A — cached PAT from a previous login
    const cached = await tryRevealSecret(STACK_PAT_SECRET);
    if (cached) {
      const identity = await fetchIdentity(cached);
      if (identity) {
        ctx.log({ level: "info", msg: `Reusing cached Supabase token for ${identity.email ?? identity.id}` });
        return { token: cached, identity };
      }
      ctx.log({ level: "warn", msg: "Cached Supabase token invalid; re-authenticating." });
    }

    // Path B — PKCE OAuth (requires registered Ashlr Stack OAuth client)
    if (clientId) {
      const tokenResponse = await runPkceFlow({
        providerName: "Supabase",
        clientId,
        authUrl: `${API}/v1/oauth/authorize`,
        tokenUrl: `${API}/v1/oauth/token`,
      });
      const token = tokenResponse.access_token;
      await addSecret(STACK_PAT_SECRET, token);
      const identity = await fetchIdentity(token);
      return {
        token,
        identity,
        expiresAt: tokenResponse.expires_in
          ? Date.now() + tokenResponse.expires_in * 1000
          : undefined,
      };
    }

    // Path C — PAT paste fallback (pre-OAuth-app registration)
    if (!ctx.interactive) {
      throw new StackError(
        "SUPABASE_AUTH_REQUIRED",
        "Set SUPABASE_STACK_CLIENT_ID for OAuth, or provide an access token interactively.",
      );
    }

    // Avoid a hard dependency on @clack/prompts in the core package — read from stdin.
    process.stderr.write(
      "\n  Create a Personal Access Token at https://supabase.com/dashboard/account/tokens\n  Paste it here: ",
    );
    const token = (await readLine()).trim();
    if (!token) throw new StackError("SUPABASE_AUTH_REQUIRED", "No token provided.");
    const identity = await fetchIdentity(token);
    if (!identity)
      throw new StackError("SUPABASE_AUTH_INVALID", "Supabase rejected that access token.");
    await addSecret(STACK_PAT_SECRET, token);
    return { token, identity };
  },

  async provision(
    ctx: ProviderContext,
    auth: AuthHandle,
    opts: ProvisionOpts,
  ): Promise<Resource> {
    if (opts.existingResourceId) {
      const project = await fetchProject(auth.token, opts.existingResourceId);
      if (!project)
        throw new StackError(
          "SUPABASE_PROJECT_NOT_FOUND",
          `Could not find project ${opts.existingResourceId}. Double-check the ref.`,
        );
      return toResource(project);
    }

    const orgs = await fetchOrganizations(auth.token);
    if (orgs.length === 0)
      throw new StackError(
        "SUPABASE_NO_ORGS",
        "This Supabase account has no organizations. Create one in the dashboard first.",
      );
    const orgId = orgs[0].id;
    if (orgs.length > 1) {
      ctx.log({
        level: "warn",
        msg: `Multiple Supabase orgs; defaulting to "${orgs[0].name}". Use --use <project_ref> to pick a specific project.`,
      });
    }

    const name = `stack-${Date.now().toString(36)}`;
    const region = (opts.hints?.region as string | undefined) ?? "us-east-1";
    const dbPass = generateStrongPassword();

    const res = await fetch(`${API}/v1/projects`, {
      method: "POST",
      headers: authHeaders(auth.token),
      body: JSON.stringify({
        name,
        organization_id: orgId,
        db_pass: dbPass,
        region,
        plan: "free",
      }),
    });
    if (!res.ok) {
      throw new StackError(
        "SUPABASE_CREATE_FAILED",
        `Supabase project creation failed (${res.status}): ${await res.text()}`,
      );
    }
    const project = (await res.json()) as SupabaseProject;
    // Stash the DB password as a secret too — it's otherwise unrecoverable.
    await addSecret(`SUPABASE_DB_PASSWORD_${project.id}`, dbPass);
    return toResource(project);
  },

  async materialize(
    _ctx: ProviderContext,
    resource: Resource,
    auth: AuthHandle,
  ): Promise<Materialized> {
    const keys = await fetchApiKeys(auth.token, resource.id);
    const anon = keys.find((k) => k.name === "anon")?.api_key;
    const service = keys.find((k) => k.name === "service_role")?.api_key;
    if (!anon || !service) {
      throw new StackError(
        "SUPABASE_KEYS_MISSING",
        `Supabase did not return both anon and service_role keys for ${resource.id}.`,
      );
    }
    const url = `https://${resource.id}.supabase.co`;
    return {
      secrets: {
        SUPABASE_URL: url,
        SUPABASE_ANON_KEY: anon,
        SUPABASE_SERVICE_ROLE_KEY: service,
      },
      mcp: {
        name: "supabase",
        type: "stdio",
        command: "npx",
        args: ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref", resource.id],
        env: {
          SUPABASE_ACCESS_TOKEN: `$(phantom reveal ${STACK_PAT_SECRET})`,
        },
      },
      urls: { project: url, dashboard: dashboardUrl(resource.id) },
    };
  },

  async healthcheck(_ctx: ProviderContext, entry: ServiceEntry): Promise<HealthStatus> {
    if (!entry.resource_id) return { kind: "error", detail: "missing resource_id" };
    const anon = await tryRevealSecret("SUPABASE_ANON_KEY");
    if (!anon) return { kind: "error", detail: "SUPABASE_ANON_KEY missing from vault" };
    const start = Date.now();
    try {
      // GET against the REST root. Safe to retry on transient 5xx / 429.
      const res = await fetchWithRetry(
        `https://${entry.resource_id}.supabase.co/rest/v1/`,
        { headers: { apikey: anon, Authorization: `Bearer ${anon}` } },
      );
      const latencyMs = Date.now() - start;
      if (res.ok) return { kind: "ok", latencyMs };
      return { kind: "warn", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { kind: "error", detail: (err as Error).message };
    }
  },

  dashboardUrl(entry: ServiceEntry): string {
    return entry.resource_id ? dashboardUrl(entry.resource_id) : "https://supabase.com/dashboard";
  },
};

export default supabase;

// ---------------------------------------------------------------------------
// Supabase API helpers
// ---------------------------------------------------------------------------

interface SupabaseProject {
  id: string;
  name: string;
  region: string;
  organization_id: string;
}

interface SupabaseOrg {
  id: string;
  name: string;
}

interface SupabaseApiKey {
  name: "anon" | "service_role" | string;
  api_key: string;
}

type SupabaseIdentity = Record<string, string>;

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function fetchIdentity(token: string): Promise<SupabaseIdentity | undefined> {
  try {
    // Idempotent GET — retry transient 429/5xx so a flapping Supabase gateway
    // doesn't force the user to re-paste their PAT.
    const res = await fetchWithRetry(`${API}/v1/profile`, { headers: authHeaders(token) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const out: SupabaseIdentity = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return undefined;
  }
}

async function fetchOrganizations(token: string): Promise<SupabaseOrg[]> {
  // Idempotent GET — retry transient 429/5xx.
  const res = await fetchWithRetry(`${API}/v1/organizations`, { headers: authHeaders(token) });
  if (!res.ok)
    throw new StackError(
      "SUPABASE_ORGS_FAILED",
      `Couldn't list Supabase orgs (${res.status}): ${await res.text()}`,
    );
  return (await res.json()) as SupabaseOrg[];
}

async function fetchProject(token: string, ref: string): Promise<SupabaseProject | undefined> {
  // Idempotent GET — retry transient failures before surfacing 404 vs. outage.
  const res = await fetchWithRetry(`${API}/v1/projects/${ref}`, { headers: authHeaders(token) });
  if (res.status === 404) return undefined;
  if (!res.ok)
    throw new StackError(
      "SUPABASE_PROJECT_FAILED",
      `Couldn't fetch Supabase project ${ref} (${res.status}).`,
    );
  return (await res.json()) as SupabaseProject;
}

async function fetchApiKeys(token: string, ref: string): Promise<SupabaseApiKey[]> {
  // Idempotent GET — materialize calls this immediately after provision.
  const res = await fetchWithRetry(`${API}/v1/projects/${ref}/api-keys`, {
    headers: authHeaders(token),
  });
  if (!res.ok)
    throw new StackError(
      "SUPABASE_KEYS_FAILED",
      `Couldn't fetch Supabase API keys (${res.status}): ${await res.text()}`,
    );
  return (await res.json()) as SupabaseApiKey[];
}

function toResource(project: SupabaseProject): Resource {
  return {
    id: project.id,
    displayName: project.name,
    region: project.region,
    meta: { organization_id: project.organization_id },
  };
}

function dashboardUrl(ref: string): string {
  return `https://supabase.com/dashboard/project/${ref}`;
}

function generateStrongPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString("base64").replace(/[/+=]/g, "").slice(0, 32);
}

// Silence unused-import linters — phantomExec may be used in future extensions.
void phantomExec;
