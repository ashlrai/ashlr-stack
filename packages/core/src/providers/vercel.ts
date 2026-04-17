import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { addSecret } from "../phantom.ts";
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
 * Vercel provider.
 *
 * v1 takes a personal access token (users create one at
 * https://vercel.com/account/tokens). Provision either creates a new project
 * or attaches to an existing one by id. Materialize stores the token + links
 * the project for future `stack sync --platform vercel` calls.
 */

const API = "https://api.vercel.com";
const TOKEN_SECRET = "VERCEL_TOKEN";

const vercel: Provider = {
  name: "vercel",
  displayName: "Vercel",
  category: "deploy",
  authKind: "pat",
  docs: "https://vercel.com/docs/rest-api",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const cached = await tryRevealSecret(TOKEN_SECRET);
    if (cached) {
      const identity = await fetchUser(cached);
      if (identity) return { token: cached, identity };
      ctx.log({ level: "warn", msg: "Cached Vercel token invalid; re-entering." });
    }
    if (!ctx.interactive)
      throw new StackError("VERCEL_AUTH_REQUIRED", "No valid Vercel token in vault.");
    process.stderr.write(
      "\n  Create a Vercel token at https://vercel.com/account/tokens\n  Paste it here: ",
    );
    const token = (await readLine()).trim();
    const identity = await fetchUser(token);
    if (!identity) throw new StackError("VERCEL_AUTH_INVALID", "Vercel rejected that token.");
    await addSecret(TOKEN_SECRET, token);
    return { token, identity };
  },

  async provision(ctx, auth, opts: ProvisionOpts): Promise<Resource> {
    if (opts.existingResourceId) {
      const project = await fetchProject(auth.token, opts.existingResourceId);
      if (!project)
        throw new StackError("VERCEL_PROJECT_NOT_FOUND", `No Vercel project ${opts.existingResourceId}.`);
      return { id: project.id, displayName: project.name };
    }
    const name = `stack-${Date.now().toString(36)}`;
    const res = await fetch(`${API}/v11/projects`, {
      method: "POST",
      headers: authHeaders(auth.token),
      body: JSON.stringify({ name, framework: null }),
    });
    if (!res.ok) {
      throw new StackError(
        "VERCEL_CREATE_FAILED",
        `Vercel project creation failed (${res.status}): ${await res.text()}`,
      );
    }
    const project = (await res.json()) as { id: string; name: string };
    ctx.log({ level: "info", msg: `Vercel project ${project.name} created.` });
    return { id: project.id, displayName: project.name };
  },

  async materialize(_ctx, resource, auth): Promise<Materialized> {
    return {
      secrets: { [TOKEN_SECRET]: auth.token },
      urls: {
        project: `https://vercel.com/dashboard/${resource.id}`,
      },
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
      ? `https://vercel.com/dashboard/${entry.resource_id}`
      : "https://vercel.com/dashboard";
  },
};

export default vercel;

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function fetchUser(token: string): Promise<Record<string, string> | undefined> {
  try {
    const res = await fetch(`${API}/v2/user`, { headers: authHeaders(token) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { user?: { uid?: string; email?: string; username?: string } };
    if (!body.user) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.user))
      if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}

async function fetchProject(token: string, id: string): Promise<{ id: string; name: string } | undefined> {
  const res = await fetch(`${API}/v9/projects/${id}`, { headers: authHeaders(token) });
  if (res.status === 404) return undefined;
  if (!res.ok) return undefined;
  return (await res.json()) as { id: string; name: string };
}


