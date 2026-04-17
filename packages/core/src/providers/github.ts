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
  Resource,
} from "./_base.ts";

/**
 * GitHub — OAuth device flow (no local redirect needed, works in SSH/remote
 * sessions). Requires a GitHub OAuth App; we fall back to PAT paste when the
 * client id isn't configured.
 *
 * Device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

const TOKEN_SECRET = "GITHUB_TOKEN";
const DEFAULT_SCOPE = "repo,read:org,read:user";

const github: Provider = {
  name: "github",
  displayName: "GitHub",
  category: "code",
  authKind: "oauth_device",
  docs: "https://docs.github.com/en/rest",

  async login(ctx: ProviderContext): Promise<AuthHandle> {
    const cached = await tryRevealSecret(TOKEN_SECRET);
    if (cached) {
      const identity = await fetchUser(cached);
      if (identity) return { token: cached, identity };
      ctx.log({ level: "warn", msg: "Cached GitHub token invalid; re-authenticating." });
    }

    const clientId = process.env.GITHUB_STACK_CLIENT_ID;
    if (clientId) {
      const token = await runDeviceFlow(clientId);
      const identity = await fetchUser(token);
      if (!identity)
        throw new StackError("GITHUB_AUTH_INVALID", "GitHub accepted the code but rejected the token.");
      await addSecret(TOKEN_SECRET, token);
      return { token, identity };
    }

    // PAT fallback.
    if (!ctx.interactive)
      throw new StackError("GITHUB_AUTH_REQUIRED", "Set GITHUB_STACK_CLIENT_ID or paste a PAT.");
    process.stderr.write(
      "\n  Create a GitHub PAT at https://github.com/settings/personal-access-tokens/new\n  Paste it here: ",
    );
    const token = (await readLine()).trim();
    const identity = await fetchUser(token);
    if (!identity) throw new StackError("GITHUB_AUTH_INVALID", "GitHub rejected that token.");
    await addSecret(TOKEN_SECRET, token);
    return { token, identity };
  },

  async provision(_ctx, auth, opts): Promise<Resource> {
    const login = auth.identity?.login ?? "user";
    if (opts.existingResourceId) {
      return { id: opts.existingResourceId, displayName: opts.existingResourceId };
    }
    // v1 doesn't auto-create repos — users usually have a repo already. We
    // attach to the account and surface the login as the resource id.
    return { id: login, displayName: `@${login}` };
  },

  async materialize(_ctx, _resource, auth): Promise<Materialized> {
    return {
      secrets: { [TOKEN_SECRET]: auth.token },
      mcp: {
        name: "github",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: `$(phantom reveal ${TOKEN_SECRET})` },
      },
    };
  },

  async healthcheck(_ctx, _entry: ServiceEntry): Promise<HealthStatus> {
    const token = await tryRevealSecret(TOKEN_SECRET);
    if (!token) return { kind: "error", detail: `${TOKEN_SECRET} missing from vault` };
    const start = Date.now();
    const user = await fetchUser(token);
    const latencyMs = Date.now() - start;
    return user ? { kind: "ok", latencyMs } : { kind: "error", detail: "token invalid" };
  },

  dashboardUrl(): string {
    return "https://github.com";
  },
};

export default github;

async function fetchUser(token: string): Promise<Record<string, string> | undefined> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ashlr-stack",
      },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body))
      if (typeof v === "string" || typeof v === "number") out[k] = String(v);
    return out;
  } catch {
    return undefined;
  }
}

async function runDeviceFlow(clientId: string): Promise<string> {
  // 1. Request device code.
  const startRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: DEFAULT_SCOPE }),
  });
  if (!startRes.ok)
    throw new StackError("GITHUB_DEVICE_START_FAILED", `device/code ${startRes.status}`);
  const {
    device_code,
    user_code,
    verification_uri,
    interval,
    expires_in,
  } = (await startRes.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
    expires_in: number;
  };

  process.stderr.write(
    `\n  Visit ${verification_uri} and enter this code: ${user_code}\n  (waiting for approval…)\n`,
  );

  // 2. Poll for the token.
  const deadline = Date.now() + expires_in * 1000;
  let pollInterval = (interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const body = (await res.json()) as {
      access_token?: string;
      error?: string;
      interval?: number;
    };
    if (body.access_token) return body.access_token;
    if (body.error === "slow_down") pollInterval += 5000;
    else if (body.error === "authorization_pending") continue;
    else throw new StackError("GITHUB_DEVICE_FAILED", body.error ?? "unknown error");
  }
  throw new StackError("GITHUB_DEVICE_TIMEOUT", "Device flow timed out.");
}


