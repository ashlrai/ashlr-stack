import type { ServiceEntry } from "../config.ts";
import { StackError } from "../errors.ts";
import { addSecret } from "../phantom.ts";
import { readLine, tryRevealSecret } from "./_helpers.ts";
import type {
  AuthHandle,
  HealthStatus,
  Materialized,
  McpServerEntry,
  Provider,
  ProviderCategory,
  ProviderContext,
  Resource,
} from "./_base.ts";

/**
 * Factory for API-key-paste providers (OpenAI, Anthropic, xAI, DeepSeek, Resend,
 * PostHog-PAT, Upstash, Clerk, Railway, Fly). These providers don't provision
 * upstream resources — they just validate a pasted key and route it into the
 * Phantom vault under a canonical secret name.
 */

export interface ApiKeyProviderSpec {
  name: string;
  displayName: string;
  category: ProviderCategory;
  docs: string;
  /** .env name for the key. Also the Phantom vault key. */
  secretName: string;
  /** Optional friendly instruction shown when prompting for the key. */
  howTo: string;
  /**
   * Verify the pasted key against the provider's API. Return an identity object
   * (e.g. org id, account email) on success, undefined on invalid.
   */
  verify(key: string): Promise<Record<string, string> | undefined>;
  /** Optional dashboard URL (used by `stack open`). */
  dashboard?: string;
  /** Optional MCP server entry to wire into .mcp.json. */
  mcp?: McpServerEntry;
  /**
   * Optional health check. Defaults to re-running `verify` against the stored
   * secret, which is the right call for stateless API keys.
   */
  healthcheck?: (ctx: ProviderContext, entry: ServiceEntry) => Promise<HealthStatus>;
}

export function makeApiKeyProvider(spec: ApiKeyProviderSpec): Provider {
  return {
    name: spec.name,
    displayName: spec.displayName,
    category: spec.category,
    authKind: "api_key",
    docs: spec.docs,

    async login(ctx: ProviderContext): Promise<AuthHandle> {
      const cached = await tryRevealSecret(spec.secretName);
      if (cached) {
        const identity = await spec.verify(cached);
        if (identity) return { token: cached, identity };
        ctx.log({ level: "warn", msg: `Cached ${spec.displayName} key invalid; re-entering.` });
      }
      if (!ctx.interactive) {
        throw new StackError(
          `${spec.name.toUpperCase()}_AUTH_REQUIRED`,
          `${spec.displayName}: no valid key in vault and session is non-interactive.`,
        );
      }
      process.stderr.write(`\n  ${spec.howTo}\n  Paste your ${spec.displayName} API key: `);
      const key = (await readLine()).trim();
      if (!key) throw new StackError(`${spec.name.toUpperCase()}_AUTH_REQUIRED`, "No key provided.");
      const identity = await spec.verify(key);
      if (!identity)
        throw new StackError(
          `${spec.name.toUpperCase()}_AUTH_INVALID`,
          `${spec.displayName} rejected that key.`,
        );
      // Persist the verified key immediately. Previously we deferred to
      // `materialize()`, so if any step after `login()` threw (e.g. a
      // provision-side API error) the user would have to re-paste their key.
      // Matches the hand-written providers (supabase, neon, vercel, github, sentry).
      await addSecret(spec.secretName, key);
      return { token: key, identity };
    },

    async provision(_ctx, auth, opts): Promise<Resource> {
      const id = opts.existingResourceId ?? auth.identity?.id ?? auth.identity?.org_id ?? "default";
      return {
        id,
        displayName:
          (auth.identity?.name as string | undefined) ??
          (auth.identity?.email as string | undefined) ??
          spec.displayName,
        meta: auth.identity,
      };
    },

    async materialize(_ctx, _resource, auth): Promise<Materialized> {
      await addSecret(spec.secretName, auth.token);
      return {
        secrets: { [spec.secretName]: auth.token },
        ...(spec.mcp ? { mcp: spec.mcp } : {}),
      };
    },

    async healthcheck(ctx, entry) {
      if (spec.healthcheck) return spec.healthcheck(ctx, entry);
      const key = await tryRevealSecret(spec.secretName);
      if (!key) return { kind: "error", detail: `${spec.secretName} missing from vault` };
      const start = Date.now();
      const identity = await spec.verify(key);
      const latencyMs = Date.now() - start;
      return identity ? { kind: "ok", latencyMs } : { kind: "error", detail: "key invalid" };
    },

    dashboardUrl() {
      return spec.dashboard ?? "";
    },
  };
}


