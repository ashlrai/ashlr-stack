import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { addSecret, revealSecret } from "../phantom.ts";
import { fetchWithRetry } from "../http.ts";
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
    if (!identity) throw new StackError("CLOUDFLARE_AUTH_INVALID", "Cloudflare rejected that token.");
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
