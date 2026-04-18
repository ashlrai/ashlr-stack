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
 * Sentry — error tracking. v1 uses an Auth Token (users create one at
 * https://sentry.io/settings/account/api/auth-tokens/ with scope `project:write`
 * `org:read`). Provision attaches to an existing project by slug; we don't
 * auto-create in v1 because Sentry projects require a platform choice.
 *
 * API reference: https://docs.sentry.io/api/
 */

const API = "https://sentry.io/api/0";
const TOKEN_SECRET = "SENTRY_AUTH_TOKEN";

const sentry: Provider = {
  name: "sentry",
  displayName: "Sentry",
  category: "errors",
  authKind: "pat",
  docs: "https://docs.sentry.io/api/",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const cached = await tryRevealSecret(TOKEN_SECRET);
    if (cached) {
      const identity = await fetchIdentity(cached);
      if (identity) return { token: cached, identity };
      ctx.log({ level: "warn", msg: "Cached Sentry token invalid." });
    }
    if (!ctx.interactive) throw new StackError("SENTRY_AUTH_REQUIRED", "No valid Sentry token.");
    process.stderr.write(
      "\n  Create a Sentry Auth Token at https://sentry.io/settings/account/api/auth-tokens/\n  Required scopes: project:write, org:read\n  Paste it here: ",
    );
    const token = (await readLine()).trim();
    const identity = await fetchIdentity(token);
    if (!identity) throw new StackError("SENTRY_AUTH_INVALID", "Sentry rejected that token.");
    await addSecret(TOKEN_SECRET, token);
    return { token, identity };
  },

  async provision(ctx, auth, opts: ProvisionOpts): Promise<Resource> {
    if (opts.existingResourceId) {
      const [orgSlug, projectSlug] = opts.existingResourceId.split("/");
      if (!orgSlug || !projectSlug)
        throw new StackError(
          "SENTRY_BAD_RESOURCE_ID",
          "Sentry resource id must be `org-slug/project-slug`.",
        );
      return { id: opts.existingResourceId, displayName: projectSlug };
    }

    const orgs = await fetchOrgs(auth.token);
    if (orgs.length === 0)
      throw new StackError("SENTRY_NO_ORGS", "No Sentry organizations accessible by this token.");
    const orgSlug = orgs[0].slug;
    const projects = await fetchProjects(auth.token, orgSlug);
    if (projects.length === 0)
      throw new StackError(
        "SENTRY_NO_PROJECTS",
        `Org ${orgSlug} has no Sentry projects yet. Create one in the dashboard, then retry with --use ${orgSlug}/<slug>.`,
      );
    const project = projects[0];
    ctx.log({
      level: "info",
      msg: `Attaching to Sentry project ${orgSlug}/${project.slug}. Use --use to pick a different one.`,
    });
    return { id: `${orgSlug}/${project.slug}`, displayName: project.name };
  },

  async materialize(_ctx, resource, auth): Promise<Materialized> {
    const [orgSlug, projectSlug] = resource.id.split("/");
    const dsn = await fetchDsn(auth.token, orgSlug, projectSlug);
    const secrets: Record<string, string> = { SENTRY_AUTH_TOKEN: auth.token };
    if (dsn) secrets.SENTRY_DSN = dsn;
    secrets.SENTRY_ORG = orgSlug;
    secrets.SENTRY_PROJECT = projectSlug;
    return {
      secrets,
      mcp: {
        name: "sentry",
        type: "stdio",
        command: "npx",
        args: ["-y", "@sentry/mcp-server"],
        env: {
          SENTRY_AUTH_TOKEN: `$(phantom reveal ${TOKEN_SECRET})`,
          SENTRY_HOST: "https://sentry.io",
        },
      },
      urls: { dashboard: `https://sentry.io/organizations/${orgSlug}/projects/${projectSlug}/` },
    };
  },

  async healthcheck(_ctx, entry: ServiceEntry): Promise<HealthStatus> {
    const token = await tryRevealSecret(TOKEN_SECRET);
    if (!token) return { kind: "error", detail: `${TOKEN_SECRET} missing from vault` };
    if (!entry.resource_id) return { kind: "warn", detail: "no resource_id" };
    const [orgSlug, projectSlug] = entry.resource_id.split("/");
    const start = Date.now();
    // Idempotent GET — retry transient 429/5xx so a Sentry hiccup doesn't
    // falsely mark the healthcheck red.
    const res = await fetchWithRetry(`${API}/projects/${orgSlug}/${projectSlug}/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latencyMs = Date.now() - start;
    return res.ok
      ? { kind: "ok", latencyMs }
      : { kind: "error", detail: `HTTP ${res.status}` };
  },

  dashboardUrl(entry: ServiceEntry): string {
    if (!entry.resource_id) return "https://sentry.io";
    const [orgSlug, projectSlug] = entry.resource_id.split("/");
    return `https://sentry.io/organizations/${orgSlug}/projects/${projectSlug}/`;
  },
};

export default sentry;

async function fetchIdentity(token: string): Promise<Record<string, string> | undefined> {
  try {
    // Idempotent GET — retry so a flaky Sentry gateway doesn't force re-paste.
    const res = await fetchWithRetry(`${API}/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    // Network errors surface in healthchecks; don't let them throw uncaught.
    return undefined;
  }
}

async function fetchOrgs(token: string): Promise<Array<{ slug: string; name: string }>> {
  // Idempotent GET — retry transient 429/5xx.
  const res = await fetchWithRetry(`${API}/organizations/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return (await res.json()) as Array<{ slug: string; name: string }>;
}

async function fetchProjects(
  token: string,
  orgSlug: string,
): Promise<Array<{ slug: string; name: string }>> {
  // Idempotent GET.
  const res = await fetchWithRetry(`${API}/organizations/${orgSlug}/projects/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return (await res.json()) as Array<{ slug: string; name: string }>;
}

async function fetchDsn(
  token: string,
  orgSlug: string,
  projectSlug: string,
): Promise<string | undefined> {
  // Idempotent GET — called by materialize to fetch the DSN.
  const res = await fetchWithRetry(`${API}/projects/${orgSlug}/${projectSlug}/keys/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return undefined;
  const keys = (await res.json()) as Array<{ dsn?: { public?: string } }>;
  return keys[0]?.dsn?.public;
}


