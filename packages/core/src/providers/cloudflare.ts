import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { fetchWithRetry } from "../http.ts";
import { addSecret } from "../phantom.ts";
import { tryRevealSecret } from "./_helpers.ts";
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
 * Cloudflare — Workers / Pages / R2 / D1 / KV all hang off one Account API
 * token. v1 uses a user-created token (users make one at
 * https://dash.cloudflare.com/profile/api-tokens with minimal scopes). Auto-
 * provisioning a new Worker is intentionally deferred — most real workflows
 * start from a template or wrangler scaffold.
 */

const API = "https://api.cloudflare.com/client/v4";
const TOKEN_SECRET = "CLOUDFLARE_API_TOKEN";

const cloudflare: Provider = {
  name: "cloudflare",
  displayName: "Cloudflare",
  category: "deploy",
  authKind: "pat",
  docs: "https://developers.cloudflare.com/api",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const cached = await tryRevealSecret(TOKEN_SECRET);
    if (cached) {
      const identity = await verifyToken(cached);
      if (identity) return { token: cached, identity };
      ctx.log({ level: "warn", msg: "Cached Cloudflare token invalid." });
    }
    if (!ctx.interactive)
      throw new StackError("CLOUDFLARE_AUTH_REQUIRED", "No valid Cloudflare token in vault.");
    process.stderr.write(
      "\n  Create an API token at https://dash.cloudflare.com/profile/api-tokens\n  Scopes: Account · Workers Scripts / Pages / R2 / D1 as needed\n  Paste it here: ",
    );
    const token = (await readLine()).trim();
    const identity = await verifyToken(token);
    if (!identity)
      throw new StackError("CLOUDFLARE_AUTH_INVALID", "Cloudflare rejected that token.");
    await addSecret(TOKEN_SECRET, token);
    return { token, identity };
  },

  async provision(ctx, auth, opts: ProvisionOpts): Promise<Resource> {
    const accounts = await fetchAccounts(auth.token);
    if (accounts.length === 0)
      throw new StackError("CLOUDFLARE_NO_ACCOUNT", "Token has no account scope.");
    const accountId = (opts.hints?.accountId as string | undefined) ?? accounts[0].id;
    if (accounts.length > 1) {
      ctx.log({
        level: "warn",
        msg: `Multiple Cloudflare accounts; defaulting to "${accounts[0].name}". Pass --use <account-id> to pick.`,
      });
    }
    return {
      id: opts.existingResourceId ?? accountId,
      displayName: accounts.find((a) => a.id === accountId)?.name ?? accountId,
      meta: { account_id: accountId },
    };
  },

  async materialize(_ctx, resource, auth): Promise<Materialized> {
    return {
      secrets: {
        CLOUDFLARE_API_TOKEN: auth.token,
        CLOUDFLARE_ACCOUNT_ID: resource.id,
      },
      urls: { dashboard: `https://dash.cloudflare.com/${resource.id}` },
    };
  },

  async healthcheck(_ctx, _entry: ServiceEntry): Promise<HealthStatus> {
    const token = await tryRevealSecret(TOKEN_SECRET);
    if (!token) return { kind: "error", detail: `${TOKEN_SECRET} missing from vault` };
    const start = Date.now();
    const identity = await verifyToken(token);
    const latencyMs = Date.now() - start;
    return identity ? { kind: "ok", latencyMs } : { kind: "error", detail: "token invalid" };
  },

  dashboardUrl(entry: ServiceEntry): string {
    return entry.resource_id
      ? `https://dash.cloudflare.com/${entry.resource_id}`
      : "https://dash.cloudflare.com";
  },

  /**
   * Cloudflare deprovision — the v1 provision attaches to an existing account
   * (no new account or Worker is created). Deprovision validates the token is
   * still active, then is a no-op since there is no upstream resource to delete.
   */
  async deprovision(ctx: ProviderContext, auth: AuthHandle, resourceId: string): Promise<void> {
    if (ctx.signal?.aborted) {
      throw new StackError("CLOUDFLARE_DEPROVISION_ABORTED", "Cloudflare deprovision cancelled.");
    }

    // Validate the account is still accessible with this token.
    try {
      const res = await fetch(`${API}/accounts/${resourceId}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: ctx.signal,
      });
      if (res.status === 404) return; // account gone or token lost access — treat as success
      if (res.status === 403 || res.status === 401) {
        throw new StackError(
          "CLOUDFLARE_DEPROVISION_FORBIDDEN",
          `Cloudflare returned ${res.status} validating account ${resourceId}. ` +
            `Check token scopes at https://dash.cloudflare.com/profile/api-tokens.`,
        );
      }
      // Any other non-ok response is unexpected — surface it.
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          errors?: Array<{ message?: string }>;
        };
        const detail = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
        throw new StackError(
          "CLOUDFLARE_DEPROVISION_FAILED",
          `Cloudflare returned error validating account ${resourceId}: ${detail}. ` +
            `Check at https://dash.cloudflare.com.`,
        );
      }
    } catch (err) {
      if (err instanceof StackError) throw err;
      throw new StackError(
        "CLOUDFLARE_DEPROVISION_FAILED",
        `Cloudflare deprovision failed for ${resourceId}: ${(err as Error).message}. ` +
          `Check at https://dash.cloudflare.com.`,
      );
    }
    // Account attachment only — no upstream resource to delete.
  },
};

export default cloudflare;

async function verifyToken(token: string): Promise<Record<string, string> | undefined> {
  try {
    // Idempotent GET — healthcheck hits this on every loop.
    const res = await fetchWithRetry(`${API}/user/tokens/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { result?: { id?: string; status?: string } };
    if (body.result?.status !== "active") return undefined;
    return { token_id: body.result.id ?? "" };
  } catch {
    return undefined;
  }
}

async function fetchAccounts(token: string): Promise<Array<{ id: string; name: string }>> {
  // Idempotent GET — retry transient failures on `stack add` startup.
  const res = await fetchWithRetry(`${API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { result?: Array<{ id: string; name: string }> };
  return body.result ?? [];
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
