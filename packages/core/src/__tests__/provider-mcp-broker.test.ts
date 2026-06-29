/**
 * Tests for ProviderMcpBroker — live pricing lookup with session cache,
 * timeout fallback to static, and correctness of pricing synthesis.
 *
 * Covers:
 *   - Fallback to static when MCP call times out
 *   - Fallback to static when MCP invoke throws
 *   - Cache hits: second call does not invoke MCP again
 *   - Cache invalidation
 *   - Live data returned when MCP invoke succeeds
 *   - getCostEstimateWithFallback: live overrides static
 *   - getCostEstimateWithFallback: static used when live unavailable
 *   - All 6 providers have MCP definitions
 *   - In dry-run.ts integration: livePricing:true uses broker, source is "mcp"
 *   - In dry-run.ts integration: livePricing:false uses static, source is "static"
 *   - Recommend output shows [live] badge when live pricing available
 *   - Recommend output shows [estimated] badge when falling back to static
 *   - Session broker singleton: getSessionBroker / setSessionBroker / resetSessionBroker
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ProviderMcpBroker,
  getCostEstimateWithFallback,
  getSessionBroker,
  resetSessionBroker,
  setSessionBroker,
  type McpInvokeFn,
} from "../provider-mcp-broker.ts";
import { dryRunProvider, getStaticCostEstimate } from "../dry-run.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** MCP invoke that always succeeds with a minimal response. */
function makeLiveInvoke(overrides: Record<string, unknown> = {}): McpInvokeFn {
  return async (_server, _tool, _args) => ({
    notes: "Live pricing from test mock.",
    input_per_1m_usd: 1.5,
    output_per_1m_usd: 6.0,
    hobby_monthly_usd: 0,
    pro_monthly_usd: 20,
    team_monthly_usd: 4,
    ...overrides,
  });
}

/** MCP invoke that always throws (simulates unavailable server). */
const failingInvoke: McpInvokeFn = async () => {
  throw new Error("MCP server not available");
};

/** MCP invoke that hangs indefinitely (simulates timeout). */
const hangingInvoke: McpInvokeFn = () => new Promise(() => {/* never resolves */});

// ---------------------------------------------------------------------------
// ProviderMcpBroker — basic
// ---------------------------------------------------------------------------

describe("ProviderMcpBroker.supportedProviders", () => {
  test("returns all 6 high-volume providers", () => {
    const providers = ProviderMcpBroker.supportedProviders();
    expect(providers).toContain("stripe");
    expect(providers).toContain("vercel");
    expect(providers).toContain("github");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("aws");
    expect(providers.length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Fallback on MCP error
// ---------------------------------------------------------------------------

describe("ProviderMcpBroker — fallback on error", () => {
  test("returns undefined when MCP invoke throws (not in static registry handled upstream)", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: failingInvoke });
    const result = await broker.fetchLivePricing("stripe");
    expect(result).toBeUndefined();
  });

  test("getLiveCostEstimate returns undefined on MCP error", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: failingInvoke });
    const est = await broker.getLiveCostEstimate("stripe");
    expect(est).toBeUndefined();
  });

  test("returns undefined for unsupported provider even with live invoke", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const result = await broker.fetchLivePricing("supabase");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fallback on timeout
// ---------------------------------------------------------------------------

describe("ProviderMcpBroker — timeout fallback", () => {
  test("returns undefined when MCP call times out", async () => {
    const broker = new ProviderMcpBroker({
      mcpInvoke: hangingInvoke,
      timeoutMs: 50, // very short timeout for test speed
    });
    const result = await broker.fetchLivePricing("openai");
    expect(result).toBeUndefined();
  }, 2000);

  test("getLiveCostEstimate returns undefined on timeout", async () => {
    const broker = new ProviderMcpBroker({
      mcpInvoke: hangingInvoke,
      timeoutMs: 50,
    });
    const est = await broker.getLiveCostEstimate("anthropic");
    expect(est).toBeUndefined();
  }, 2000);
});

// ---------------------------------------------------------------------------
// Live data returned on success
// ---------------------------------------------------------------------------

describe("ProviderMcpBroker — live data", () => {
  test("returns live pricing data when MCP call succeeds (stripe)", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const result = await broker.fetchLivePricing("stripe");
    expect(result).toBeDefined();
    expect(result!.provider).toBe("stripe");
    expect(result!.fetchedAt).toBeTruthy();
    expect(typeof result!.notes).toBe("string");
  });

  test("stripe has null monthlyUsd (usage-based) even from live call", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const result = await broker.fetchLivePricing("stripe");
    expect(result!.monthlyUsd).toBeNull();
    expect(result!.tier).toBe("usage-based");
  });

  test("vercel has monthlyUsd = 0 for hobby tier from live call", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const result = await broker.fetchLivePricing("vercel");
    expect(result!.monthlyUsd).toBe(0);
    expect(result!.tier).toBe("hobby");
  });

  test("anthropic live data has usage-based pricing note", async () => {
    const broker = new ProviderMcpBroker({
      mcpInvoke: makeLiveInvoke({ input_per_1m_usd: 1.5, output_per_1m_usd: 6.0 }),
    });
    const result = await broker.fetchLivePricing("anthropic");
    expect(result!.notes).toContain("1.5");
    expect(result!.notes).toContain("6");
  });

  test("openai live data includes pricing per 1M tokens", async () => {
    const broker = new ProviderMcpBroker({
      mcpInvoke: makeLiveInvoke({ input_per_1m_usd: 2.5, output_per_1m_usd: 10 }),
    });
    const result = await broker.fetchLivePricing("openai");
    expect(result!.notes).toContain("2.5");
    expect(result!.notes).toContain("10");
  });

  test("getLiveCostEstimate source is 'mcp' for live data", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const est = await broker.getLiveCostEstimate("openai");
    expect(est).toBeDefined();
    expect(est!.source).toBe("mcp");
    expect(est!.provider).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------

describe("ProviderMcpBroker — cache", () => {
  test("second call returns cached result without calling MCP again", async () => {
    let callCount = 0;
    const countingInvoke: McpInvokeFn = async (_s, _t, _a) => {
      callCount++;
      return { notes: "cached test" };
    };
    const broker = new ProviderMcpBroker({ mcpInvoke: countingInvoke, cacheTtlMs: 5_000 });

    await broker.fetchLivePricing("github");
    await broker.fetchLivePricing("github");
    expect(callCount).toBe(1);
  });

  test("isCached returns true after a successful call", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke(), cacheTtlMs: 5_000 });
    expect(broker.isCached("vercel")).toBe(false);
    await broker.fetchLivePricing("vercel");
    expect(broker.isCached("vercel")).toBe(true);
  });

  test("isCached returns false after invalidation", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke(), cacheTtlMs: 5_000 });
    await broker.fetchLivePricing("aws");
    expect(broker.isCached("aws")).toBe(true);
    broker.invalidate("aws");
    expect(broker.isCached("aws")).toBe(false);
  });

  test("invalidate() with no args clears all entries", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke(), cacheTtlMs: 5_000 });
    await broker.fetchLivePricing("stripe");
    await broker.fetchLivePricing("vercel");
    expect(broker.isCached("stripe")).toBe(true);
    expect(broker.isCached("vercel")).toBe(true);
    broker.invalidate();
    expect(broker.isCached("stripe")).toBe(false);
    expect(broker.isCached("vercel")).toBe(false);
  });

  test("expired cache entry triggers a fresh MCP call", async () => {
    let callCount = 0;
    const countingInvoke: McpInvokeFn = async () => {
      callCount++;
      return { notes: "expired" };
    };
    const broker = new ProviderMcpBroker({
      mcpInvoke: countingInvoke,
      cacheTtlMs: 1, // expires almost immediately
    });
    await broker.fetchLivePricing("github");
    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 10));
    await broker.fetchLivePricing("github");
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getCostEstimateWithFallback
// ---------------------------------------------------------------------------

describe("getCostEstimateWithFallback", () => {
  test("returns live estimate when broker succeeds", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const staticEst = getStaticCostEstimate("stripe");
    const result = await getCostEstimateWithFallback("stripe", staticEst, broker);
    expect(result).toBeDefined();
    expect(result!.source).toBe("mcp");
  });

  test("returns static estimate when broker fails", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: failingInvoke });
    const staticEst = getStaticCostEstimate("stripe");
    const result = await getCostEstimateWithFallback("stripe", staticEst, broker);
    expect(result).toBeDefined();
    expect(result!.source).toBe("static");
    expect(result!.provider).toBe("stripe");
  });

  test("returns static estimate when broker times out", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: hangingInvoke, timeoutMs: 50 });
    const staticEst = getStaticCostEstimate("openai");
    const result = await getCostEstimateWithFallback("openai", staticEst, broker);
    expect(result!.source).toBe("static");
  }, 2000);

  test("returns undefined when no static and no live (unknown provider)", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: failingInvoke });
    const result = await getCostEstimateWithFallback("not-a-provider", undefined, broker);
    expect(result).toBeUndefined();
  });

  test("live data overrides static even when static is also available", async () => {
    const broker = new ProviderMcpBroker({
      mcpInvoke: makeLiveInvoke({ pro_monthly_usd: 25 }),
    });
    const staticEst = getStaticCostEstimate("vercel");
    const result = await getCostEstimateWithFallback("vercel", staticEst, broker);
    // Live should win
    expect(result!.source).toBe("mcp");
    expect(result!.notes).toContain("25");
  });
});

// ---------------------------------------------------------------------------
// Session broker singleton
// ---------------------------------------------------------------------------

describe("session broker singleton", () => {
  afterEach(() => {
    resetSessionBroker();
  });

  test("getSessionBroker returns a ProviderMcpBroker instance", () => {
    const broker = getSessionBroker();
    expect(broker).toBeInstanceOf(ProviderMcpBroker);
  });

  test("getSessionBroker returns same instance on repeated calls", () => {
    const b1 = getSessionBroker();
    const b2 = getSessionBroker();
    expect(b1).toBe(b2);
  });

  test("setSessionBroker replaces the singleton", () => {
    const custom = new ProviderMcpBroker({ mcpInvoke: failingInvoke });
    setSessionBroker(custom);
    expect(getSessionBroker()).toBe(custom);
  });

  test("resetSessionBroker causes getSessionBroker to return a new instance", () => {
    const b1 = getSessionBroker();
    resetSessionBroker();
    const b2 = getSessionBroker();
    expect(b1).not.toBe(b2);
  });
});

// ---------------------------------------------------------------------------
// dry-run.ts integration: livePricing flag
// ---------------------------------------------------------------------------

describe("dryRunProvider — livePricing integration", () => {
  test("livePricing:false → source is 'static'", async () => {
    const result = await dryRunProvider("stripe", {
      costEstimate: true,
      livePricing: false,
    });
    expect(result.costEstimate).toBeDefined();
    expect(result.costEstimate!.source).toBe("static");
  });

  test("livePricing:true with failing broker → falls back to static source", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: failingInvoke });
    const result = await dryRunProvider("stripe", {
      costEstimate: true,
      livePricing: true,
      pricingBroker: broker,
    });
    expect(result.costEstimate).toBeDefined();
    expect(result.costEstimate!.source).toBe("static");
  });

  test("livePricing:true with live broker → source is 'mcp'", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const result = await dryRunProvider("stripe", {
      costEstimate: true,
      livePricing: true,
      pricingBroker: broker,
    });
    expect(result.costEstimate).toBeDefined();
    expect(result.costEstimate!.source).toBe("mcp");
  });

  test("livePricing:true with timing-out broker → falls back to static", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: hangingInvoke, timeoutMs: 50 });
    const result = await dryRunProvider("openai", {
      costEstimate: true,
      livePricing: true,
      pricingBroker: broker,
    });
    expect(result.costEstimate!.source).toBe("static");
  }, 2000);

  test("formatDryRunReport shows [live] badge when source is mcp", async () => {
    const { formatDryRunReport, dryRunProviders } = await import("../dry-run.ts");
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const report = await dryRunProviders(["stripe"], {
      costEstimate: true,
      livePricing: true,
      pricingBroker: broker,
    });
    const text = formatDryRunReport(report);
    expect(text).toContain("[live]");
    expect(text).not.toContain("[estimated]");
  });

  test("formatDryRunReport shows [estimated] badge when source is static", async () => {
    const { formatDryRunReport, dryRunProviders } = await import("../dry-run.ts");
    const report = await dryRunProviders(["stripe"], {
      costEstimate: true,
      livePricing: false,
    });
    const text = formatDryRunReport(report);
    expect(text).toContain("[estimated]");
    expect(text).not.toContain("[live]");
  });
});

// ---------------------------------------------------------------------------
// Correctness of pricing synthesis per provider
// ---------------------------------------------------------------------------

describe("pricing synthesis correctness", () => {
  test("github live pricing notes mention team price from response", async () => {
    const broker = new ProviderMcpBroker({
      mcpInvoke: makeLiveInvoke({ team_monthly_usd: 6 }),
    });
    const data = await broker.fetchLivePricing("github");
    expect(data!.notes).toContain("6");
    expect(data!.notes.toLowerCase()).toContain("team");
  });

  test("vercel live pricing notes mention pro price from response", async () => {
    const broker = new ProviderMcpBroker({
      mcpInvoke: makeLiveInvoke({ pro_monthly_usd: 30 }),
    });
    const data = await broker.fetchLivePricing("vercel");
    expect(data!.notes).toContain("30");
  });

  test("aws live pricing has usage-based tier regardless of response", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const data = await broker.fetchLivePricing("aws");
    expect(data!.tier).toBe("usage-based");
    expect(data!.monthlyUsd).toBeNull();
  });

  test("all 6 providers return valid LivePricingData structure from live invoke", async () => {
    const broker = new ProviderMcpBroker({ mcpInvoke: makeLiveInvoke() });
    const providers = ProviderMcpBroker.supportedProviders();
    for (const name of providers) {
      const data = await broker.fetchLivePricing(name);
      expect(data).toBeDefined();
      expect(data!.provider).toBe(name);
      expect(typeof data!.notes).toBe("string");
      expect(data!.notes.length).toBeGreaterThan(0);
      expect(typeof data!.tier).toBe("string");
      expect(data!.fetchedAt).toBeTruthy();
      expect(() => new Date(data!.fetchedAt)).not.toThrow();
    }
  });
});
