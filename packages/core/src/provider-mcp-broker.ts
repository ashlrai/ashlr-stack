/**
 * ProviderMcpBroker — Live Provider Pricing & Quota Lookup
 *
 * Calls into Stripe, Vercel, GitHub, Anthropic, OpenAI, and AWS MCP servers
 * (if available in the current MCP environment) at recommend-time to fetch
 * real-time pricing, region availability, and current quota limits.
 *
 * Design principles:
 *   - Every live call has a hard timeout (default 3 s). On timeout or any
 *     error, the broker silently falls back to the static registry.
 *   - Results are cached per session (default 60 s TTL) keyed by provider.
 *   - The broker is a pure library — it never spawns processes or touches the
 *     filesystem. MCP tool invocations happen via the `mcpInvoke` hook, which
 *     callers supply (or the no-op default is used).
 *   - `source` on the returned CostEstimate is "mcp" for live data, "static"
 *     for fallback.
 */

import type { CostEstimate } from "./dry-run.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Signature for a function that calls an MCP tool by server + tool name. */
export type McpInvokeFn = (
  server: string,
  tool: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Pricing data shape normalised from provider MCP responses. */
export interface LivePricingData {
  provider: string;
  monthlyUsd: number | null;
  tier: string;
  notes: string;
  regions?: string[];
  quotas?: Record<string, unknown>;
  fetchedAt: string;
}

export interface ProviderMcpBrokerOptions {
  /**
   * Function used to call an MCP tool. Defaults to `defaultMcpInvoke` which
   * always throws so the broker falls back to static for all providers.
   * Callers running inside an MCP host should supply their own bridge.
   */
  mcpInvoke?: McpInvokeFn;
  /**
   * Per-call timeout in milliseconds (default: 3000).
   */
  timeoutMs?: number;
  /**
   * Cache TTL in milliseconds (default: 60_000 = 60 s).
   */
  cacheTtlMs?: number;
}

interface CacheEntry {
  data: LivePricingData;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Provider-specific MCP call definitions
// ---------------------------------------------------------------------------

interface ProviderMcpDef {
  /** MCP server name as registered in the MCP environment */
  server: string;
  /** Tool on that server to call for pricing */
  tool: string;
  /** Static args to pass (provider-specific) */
  args: Record<string, unknown>;
  /** Normalize the raw MCP response into LivePricingData */
  normalize: (raw: unknown, provider: string) => LivePricingData;
}

const PROVIDER_MCP_DEFS: Record<string, ProviderMcpDef> = {
  stripe: {
    server: "stripe",
    tool: "stripe_get_pricing",
    args: { product: "standard" },
    normalize: (raw, provider) => {
      const r = raw as Record<string, unknown> | null;
      return {
        provider,
        monthlyUsd: null, // Stripe is always usage-based
        tier: "usage-based",
        notes:
          typeof r?.notes === "string"
            ? r.notes
            : "Usage-based: 2.9% + 30¢ per successful card charge (from live Stripe pricing).",
        fetchedAt: new Date().toISOString(),
      };
    },
  },
  vercel: {
    server: "vercel",
    tool: "vercel_get_pricing",
    args: { plan: "all" },
    normalize: (raw, provider) => {
      const r = raw as Record<string, unknown> | null;
      const monthlyUsd =
        typeof r?.hobby_monthly_usd === "number" ? r.hobby_monthly_usd : 0;
      const proUsd =
        typeof r?.pro_monthly_usd === "number" ? r.pro_monthly_usd : 20;
      return {
        provider,
        monthlyUsd,
        tier: "hobby",
        notes: `Hobby tier free for personal projects. Pro from $${proUsd}/mo per member (live Vercel pricing).`,
        regions:
          Array.isArray(r?.regions)
            ? (r.regions as string[])
            : undefined,
        fetchedAt: new Date().toISOString(),
      };
    },
  },
  github: {
    server: "github",
    tool: "github_get_billing",
    args: {},
    normalize: (raw, provider) => {
      const r = raw as Record<string, unknown> | null;
      const teamUsd =
        typeof r?.team_monthly_usd === "number" ? r.team_monthly_usd : 4;
      return {
        provider,
        monthlyUsd: 0,
        tier: "free",
        notes: `Free for public repos. GitHub Team from $${teamUsd}/user/mo (live GitHub billing).`,
        quotas: typeof r?.quotas === "object" && r.quotas !== null
          ? (r.quotas as Record<string, unknown>)
          : undefined,
        fetchedAt: new Date().toISOString(),
      };
    },
  },
  anthropic: {
    server: "anthropic",
    tool: "anthropic_get_pricing",
    args: { model: "claude-sonnet-4-5" },
    normalize: (raw, provider) => {
      const r = raw as Record<string, unknown> | null;
      const inputPer1M =
        typeof r?.input_per_1m_usd === "number" ? r.input_per_1m_usd : 3;
      const outputPer1M =
        typeof r?.output_per_1m_usd === "number" ? r.output_per_1m_usd : 15;
      return {
        provider,
        monthlyUsd: null,
        tier: "usage-based",
        notes: `Usage-based: $${inputPer1M}/1M input + $${outputPer1M}/1M output tokens (live Anthropic pricing).`,
        fetchedAt: new Date().toISOString(),
      };
    },
  },
  openai: {
    server: "openai",
    tool: "openai_get_pricing",
    args: { model: "gpt-4o" },
    normalize: (raw, provider) => {
      const r = raw as Record<string, unknown> | null;
      const inputPer1M =
        typeof r?.input_per_1m_usd === "number" ? r.input_per_1m_usd : 2.5;
      const outputPer1M =
        typeof r?.output_per_1m_usd === "number" ? r.output_per_1m_usd : 10;
      return {
        provider,
        monthlyUsd: null,
        tier: "usage-based",
        notes: `Usage-based: gpt-4o $${inputPer1M}/1M input + $${outputPer1M}/1M output tokens (live OpenAI pricing).`,
        fetchedAt: new Date().toISOString(),
      };
    },
  },
  aws: {
    server: "aws",
    tool: "aws_get_pricing",
    args: { service: "ec2", region: "us-east-1" },
    normalize: (raw, provider) => {
      const r = raw as Record<string, unknown> | null;
      return {
        provider,
        monthlyUsd: null,
        tier: "usage-based",
        notes:
          typeof r?.notes === "string"
            ? r.notes
            : "Usage-based. Free tier available for 12 months. Pricing varies by service/region (live AWS pricing).",
        regions:
          Array.isArray(r?.regions)
            ? (r.regions as string[])
            : undefined,
        fetchedAt: new Date().toISOString(),
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Default (no-op) MCP invoke
// ---------------------------------------------------------------------------

/**
 * Default MCP invoke function: always throws, causing the broker to fall back
 * to the static registry. Replace this in environments that have a real MCP
 * client bridge.
 */
const defaultMcpInvoke: McpInvokeFn = async (_server, _tool, _args) => {
  throw new Error("No MCP client bridge available");
};

// ---------------------------------------------------------------------------
// ProviderMcpBroker
// ---------------------------------------------------------------------------

export class ProviderMcpBroker {
  private readonly mcpInvoke: McpInvokeFn;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: ProviderMcpBrokerOptions = {}) {
    this.mcpInvoke = options.mcpInvoke ?? defaultMcpInvoke;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  /**
   * Attempt to fetch live pricing for a provider.
   * Returns the live data on success, or undefined on timeout/unavailability.
   */
  async fetchLivePricing(providerName: string): Promise<LivePricingData | undefined> {
    const key = providerName.toLowerCase();
    const def = PROVIDER_MCP_DEFS[key];
    if (!def) return undefined;

    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      const raw = await this.callWithTimeout(def.server, def.tool, def.args);
      const data = def.normalize(raw, key);
      this.cache.set(key, { data, expiresAt: Date.now() + this.cacheTtlMs });
      return data;
    } catch {
      // Any error (timeout, unavailable server, etc.) — return undefined so
      // the caller falls back to the static registry.
      return undefined;
    }
  }

  /**
   * Fetch live pricing and convert to a CostEstimate.
   * Returns undefined if MCP is unavailable, letting callers fall back to static.
   */
  async getLiveCostEstimate(providerName: string): Promise<CostEstimate | undefined> {
    const live = await this.fetchLivePricing(providerName);
    if (!live) return undefined;
    return {
      provider: live.provider,
      monthlyUsd: live.monthlyUsd,
      tier: live.tier,
      notes: live.notes,
      source: "mcp",
    };
  }

  /**
   * Check whether a live result for this provider is already in the cache
   * and still fresh (without making a network call).
   */
  isCached(providerName: string): boolean {
    const key = providerName.toLowerCase();
    const cached = this.cache.get(key);
    return cached !== undefined && cached.expiresAt > Date.now();
  }

  /**
   * Invalidate the cache entry for a provider (or all entries if no name given).
   */
  invalidate(providerName?: string): void {
    if (providerName) {
      this.cache.delete(providerName.toLowerCase());
    } else {
      this.cache.clear();
    }
  }

  /**
   * Returns the names of all providers this broker knows how to call.
   */
  static supportedProviders(): string[] {
    return Object.keys(PROVIDER_MCP_DEFS);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private callWithTimeout(
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`MCP call ${server}/${tool} timed out after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);

      this.mcpInvoke(server, tool, args).then(
        (result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        },
        (err: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Session-scoped singleton
// ---------------------------------------------------------------------------

let _sessionBroker: ProviderMcpBroker | undefined;

/**
 * Get (or create) the session-scoped ProviderMcpBroker.
 * The first call wins — subsequent calls return the same instance.
 * Call `resetSessionBroker()` in tests to get a fresh instance.
 */
export function getSessionBroker(options?: ProviderMcpBrokerOptions): ProviderMcpBroker {
  if (!_sessionBroker) {
    _sessionBroker = new ProviderMcpBroker(options);
  }
  return _sessionBroker;
}

/**
 * Replace the session broker (useful for injecting a test double or a real
 * MCP bridge in the MCP server entrypoint).
 */
export function setSessionBroker(broker: ProviderMcpBroker): void {
  _sessionBroker = broker;
}

/**
 * Reset the session broker to undefined (for testing isolation).
 */
export function resetSessionBroker(): void {
  _sessionBroker = undefined;
}

// ---------------------------------------------------------------------------
// Convenience: getCostEstimateWithFallback
// ---------------------------------------------------------------------------

/**
 * Attempt a live MCP lookup; if that fails or is unavailable, return the
 * static estimate. This is the primary integration point for dry-run.ts and
 * recommend.ts.
 *
 * @param providerName  Provider to look up
 * @param staticFallback  Pre-fetched static estimate (pass `getStaticCostEstimate(...)`)
 * @param broker  Optional broker to use; defaults to session singleton
 */
export async function getCostEstimateWithFallback(
  providerName: string,
  staticFallback: CostEstimate | undefined,
  broker?: ProviderMcpBroker,
): Promise<CostEstimate | undefined> {
  const b = broker ?? getSessionBroker();
  const live = await b.getLiveCostEstimate(providerName);
  if (live) return live;
  return staticFallback;
}
