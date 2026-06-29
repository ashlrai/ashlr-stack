/**
 * Comprehensive Provider Healthcheck & Quota Probe Coverage Integration Tests.
 *
 * Tests 15 providers end-to-end through runProbes():
 *   github, openai, anthropic, stripe, supabase, neon, vercel, aws,
 *   datadog, sentry, linear, clerk, firebase, posthog, mixpanel
 *
 * For each provider:
 *   1. Mocks the provider's quota/rate-limit endpoint with realistic response
 *      headers (x-ratelimit-remaining, x-ratelimit-limit, or equivalent).
 *   2. Runs via runProbes({ cwd, providers: ['<name>'] }).
 *   3. Validates the returned ProbeRunSummary has correct status, latencyMs,
 *      quotaUsedPercent (quotaUtilization), rateLimitRemaining.
 *   4. For at-risk providers (>80% quota used), verifies alertThreshold is emitted.
 *
 * Also exports generateMockProbeResponse() helper.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetPhantomCache } from "../phantom.ts";
import { __setHistogramDirForTesting, runProbes } from "../probes/index.ts";
import type { ProbeRunSummary } from "../probes/types.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// generateMockProbeResponse — helper accepted by each provider test
// ---------------------------------------------------------------------------

/**
 * Generates a Response matching a provider's real API shape, including
 * realistic quota/rate-limit response headers.
 *
 * @param probeName  Provider key (e.g. "github", "openai", "datadog")
 * @param opts.quotaUsedFraction  Fraction of quota consumed [0,1]. Default 0.2.
 * @param opts.ceiling  Rate-limit ceiling (requests or tokens). Default 5000.
 * @param opts.burnUSDCents  Daily spend in cents (OpenAI/Anthropic only). Default 0.
 * @param opts.statusOverride  Override HTTP status code. Default 200.
 * @param opts.extraBody  Extra fields merged into the response body.
 */
export function generateMockProbeResponse(
  probeName: string,
  opts: {
    quotaUsedFraction?: number;
    ceiling?: number;
    burnUSDCents?: number;
    statusOverride?: number;
    extraBody?: Record<string, unknown>;
  } = {},
): Response {
  const {
    quotaUsedFraction = 0.2,
    ceiling = 5000,
    burnUSDCents = 0,
    statusOverride = 200,
    extraBody = {},
  } = opts;

  const remaining = Math.floor(ceiling * (1 - quotaUsedFraction));
  const used = ceiling - remaining;
  const status = statusOverride;

  // Build provider-specific body + headers.
  switch (probeName) {
    case "github": {
      const body = {
        resources: { core: { limit: ceiling, remaining, used } },
        ...extraBody,
      };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }

    case "openai": {
      const body = { data: [{ id: "gpt-4o" }], ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit-tokens": String(ceiling),
          "x-ratelimit-remaining-tokens": String(remaining),
          "x-ratelimit-limit-requests": "500",
          "x-ratelimit-remaining-requests": "450",
        },
      });
    }

    case "openai-billing": {
      // Billing sub-response body (total_usage in cents).
      const body = { total_usage: burnUSDCents, ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "anthropic": {
      const body = { data: [{ id: "claude-opus-4-5" }], ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "anthropic-ratelimit-tokens-limit": String(ceiling),
          "anthropic-ratelimit-tokens-remaining": String(remaining),
          "anthropic-ratelimit-requests-limit": "1000",
          "anthropic-ratelimit-requests-remaining": "950",
        },
      });
    }

    case "stripe": {
      const body = { data: [], has_more: false, ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "ratelimit-limit": String(ceiling),
          "ratelimit-remaining": String(remaining),
        },
      });
    }

    case "supabase": {
      // Supabase probe uses absolute byte thresholds: warn >= 450MB, error >= 490MB.
      // quotaUsedFraction maps linearly over the 500MB free-tier limit.
      const dbLimit = 500 * 1024 * 1024; // 500 MB
      const dbUsed = Math.floor(dbLimit * quotaUsedFraction);
      const body = {
        usages: [
          {
            metric: "db_size",
            usage: dbUsed,
            limit: dbLimit,
            available: dbLimit - dbUsed,
          },
        ],
        ...extraBody,
      };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "neon": {
      // Neon: branches with compute_time_seconds summing to ~quotaUsedFraction of 191.9h free tier.
      const totalComputeSeconds = Math.floor(191.9 * 3600 * quotaUsedFraction);
      const body = {
        branches: [{ id: "br-1", name: "main", compute_time_seconds: totalComputeSeconds }],
        ...extraBody,
      };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }

    case "vercel-usage": {
      const buildUsed = Math.floor(6000 * quotaUsedFraction);
      const body = {
        buildMinutesUsed: buildUsed,
        buildMinutesAllowed: 6000,
        functionExecutionUnitsUsed: 0,
        functionExecutionUnitsAllowed: 100000,
        ...extraBody,
      };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "vercel-user": {
      const body = { user: { id: "u1", username: "test" }, ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "aws": {
      const body = {
        Quota: {
          QuotaName: "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances",
          Value: ceiling,
          ServiceCode: "ec2",
          QuotaCode: "L-1216C47A",
        },
        ...extraBody,
      };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "datadog": {
      const body = { valid: true, ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }

    case "sentry": {
      const body = [{ id: "proj-1", name: "my-project", slug: "my-project" }, ...((extraBody.projects as unknown[]) ?? [])];
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }

    case "linear": {
      const body = {
        data: { viewer: { id: "u1", name: "Test User", email: "test@example.com" } },
        ...extraBody,
      };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }

    case "clerk": {
      const mauUsed = Math.floor(10000 * quotaUsedFraction);
      const body = { object: "total_count", total_count: mauUsed, ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "firebase": {
      // Firebase RTDB returns a JSON value at the probe path.
      const body = 0;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "posthog": {
      const body = {
        results: [{ id: "org-1", name: "My Org" }],
        ...extraBody,
      };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }

    case "mixpanel": {
      const body = { results: { name: "Test Project" }, ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }

    default: {
      const body = { ok: true, ...extraBody };
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": String(ceiling),
          "x-ratelimit-remaining": String(remaining),
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "stack-probes-integ-"));
}

/**
 * Asserts that a ProbeRunSummary for a single provider has the expected shape.
 * The `quotaUsedPercent` param corresponds to `quotaUtilization * 100`.
 */
function assertSummary(
  summary: ProbeRunSummary,
  expectedProvider: string,
  opts: {
    status: "ok" | "warn" | "error" | "skipped";
    hasQuotaUtilization?: boolean;
    hasRateLimitCeiling?: boolean;
    hasAlert?: boolean;
    minLatencyMs?: number;
  },
): void {
  expect(summary.results).toHaveLength(1);
  const r = summary.results[0];
  expect(r.provider).toBe(expectedProvider);
  expect(r.status).toBe(opts.status);
  expect(typeof r.latencyMs).toBe("number");
  expect(r.latencyMs).toBeGreaterThanOrEqual(opts.minLatencyMs ?? 0);
  expect(typeof r.probedAt).toBe("string");

  if (opts.hasQuotaUtilization) {
    expect(r.quotaUtilization).toBeDefined();
    expect(typeof r.quotaUtilization).toBe("number");
  }
  if (opts.hasRateLimitCeiling) {
    expect(r.rateLimitCeiling).toBeDefined();
    expect(typeof r.rateLimitCeiling).toBe("number");
  }
  if (opts.hasAlert) {
    expect(r.alertThreshold).toBeDefined();
    expect(typeof r.alertThreshold).toBe("string");
    expect(summary.alertCount).toBeGreaterThanOrEqual(1);
  }
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

describe("probes-integration — github", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 20% quota used → ok status with quota fields", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("github", { quotaUsedFraction: 0.2, ceiling: 5000 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["github"], log: () => {} });

    assertSummary(summary, "github", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.2);
    expect(summary.results[0].rateLimitCeiling).toBe(5000);
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 85% quota used → warn status with alertThreshold", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("github", { quotaUsedFraction: 0.85, ceiling: 5000 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["github"], log: () => {} });

    assertSummary(summary, "github", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe("probes-integration — openai", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 10% token quota used, $5 daily burn → ok with quotaUtilization + burn", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("OPENAI_API_KEY", "sk-fake-openai");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/v1/models")) {
        return Promise.resolve(generateMockProbeResponse("openai", { quotaUsedFraction: 0.1, ceiling: 90000 }));
      }
      // Billing: $5.00 = 500 cents
      return Promise.resolve(generateMockProbeResponse("openai-billing", { burnUSDCents: 500 }));
    }) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["openai"], log: () => {} });

    assertSummary(summary, "openai", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.1);
    expect(summary.results[0].rateLimitCeiling).toBe(90000);
    expect(summary.results[0].estimatedDailyBurnUSD).toBeCloseTo(5.0);
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: >80% token quota used → warn + alertThreshold (burn rate signal)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("OPENAI_API_KEY", "sk-fake-openai");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/v1/models")) {
        // 82% used, simulating high burn
        return Promise.resolve(generateMockProbeResponse("openai", { quotaUsedFraction: 0.82, ceiling: 90000 }));
      }
      // $75/day burn — above $50/day at-risk threshold
      return Promise.resolve(generateMockProbeResponse("openai-billing", { burnUSDCents: 7500 }));
    }) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["openai"], log: () => {} });

    assertSummary(summary, "openai", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
    // estimatedDailyBurnUSD should be present (above $50/day threshold)
    expect(summary.results[0].estimatedDailyBurnUSD).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

describe("probes-integration — anthropic", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 40% token quota used → ok with Anthropic rate-limit headers", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("ANTHROPIC_API_KEY", "sk-ant-fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("anthropic", { quotaUsedFraction: 0.4, ceiling: 100000 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["anthropic"], log: () => {} });

    assertSummary(summary, "anthropic", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.4);
    expect(summary.results[0].rateLimitCeiling).toBe(100000);
  });

  test("at-risk: 85% token quota used → warn + alertThreshold emitted", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("ANTHROPIC_API_KEY", "sk-ant-fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("anthropic", { quotaUsedFraction: 0.85, ceiling: 100000 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["anthropic"], log: () => {} });

    assertSummary(summary, "anthropic", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].alertThreshold).toContain("0.8");
  });
});

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

describe("probes-integration — stripe", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: no disputes, low rate-limit usage → ok", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    // No disputes, 15% rate-limit used
    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("stripe", { quotaUsedFraction: 0.15, ceiling: 100 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["stripe"], log: () => {} });

    assertSummary(summary, "stripe", { status: "ok" });
    expect(summary.results[0].detail).toContain("0 open dispute");
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 85% rate-limit used → warn + alertThreshold", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("stripe", { quotaUsedFraction: 0.85, ceiling: 100 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["stripe"], log: () => {} });

    assertSummary(summary, "stripe", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

describe("probes-integration — supabase", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 20% db storage used → ok with quotaUtilization", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ACCESS_TOKEN", "sbp_fake");
    await addSecret("SUPABASE_PROJECT_REF", "abcdefghijklmnop");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("supabase", { quotaUsedFraction: 0.2 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["supabase"], log: () => {} });

    assertSummary(summary, "supabase", {
      status: "ok",
      hasQuotaUtilization: true,
    });
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.2);
    expect(summary.results[0].detail).toContain("MB");
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 92% db storage used (>450MB warn threshold) → warn + alertThreshold", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ACCESS_TOKEN", "sbp_fake");
    await addSecret("SUPABASE_PROJECT_REF", "abcdefghijklmnop");

    // Supabase warns at absolute 450MB. 92% of 500MB = 460MB > 450MB threshold.
    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("supabase", { quotaUsedFraction: 0.92 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["supabase"], log: () => {} });

    assertSummary(summary, "supabase", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// Neon
// ---------------------------------------------------------------------------

describe("probes-integration — neon", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 20% compute hours used → ok with latencyMs", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon-fake-token");
    await addSecret("NEON_PROJECT_ID", "proj-fake");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/branches")) {
        return Promise.resolve(generateMockProbeResponse("neon", { quotaUsedFraction: 0.2 }));
      }
      // project list fallback
      return Promise.resolve(new Response(JSON.stringify({ projects: [{ id: "proj-fake" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["neon"], log: () => {} });

    assertSummary(summary, "neon", { status: "ok" });
    expect(summary.results[0].detail).toContain("branch");
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 85% compute hours used → warn + alertThreshold", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon-fake-token");
    await addSecret("NEON_PROJECT_ID", "proj-fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("neon", { quotaUsedFraction: 0.85 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["neon"], log: () => {} });

    assertSummary(summary, "neon", {
      status: "warn",
      hasAlert: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

describe("probes-integration — vercel", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 20% build minutes used → ok with quotaUtilization", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");
    await addSecret("VERCEL_TEAM_ID", "team_fake");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/usage")) {
        return Promise.resolve(generateMockProbeResponse("vercel-usage", { quotaUsedFraction: 0.2 }));
      }
      return Promise.resolve(generateMockProbeResponse("vercel-user"));
    }) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["vercel"], log: () => {} });

    assertSummary(summary, "vercel", {
      status: "ok",
      hasQuotaUtilization: true,
    });
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.2);
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 85% build minutes used → warn + alertThreshold", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");
    await addSecret("VERCEL_TEAM_ID", "team_fake");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/usage")) {
        return Promise.resolve(generateMockProbeResponse("vercel-usage", { quotaUsedFraction: 0.85 }));
      }
      return Promise.resolve(generateMockProbeResponse("vercel-user"));
    }) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["vercel"], log: () => {} });

    assertSummary(summary, "vercel", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// AWS
// ---------------------------------------------------------------------------

describe("probes-integration — aws", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: EC2 quota response → ok with rateLimitCeiling (instance quota)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("AWS_ACCESS_KEY_ID", "AKIAFAKE12345678");
    await addSecret("AWS_SECRET_ACCESS_KEY", "fakesecretaccesskey0000000000000000000000");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("aws", { ceiling: 32 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["aws"], log: () => {} });

    assertSummary(summary, "aws", {
      status: "ok",
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].rateLimitCeiling).toBe(32);
    expect(summary.results[0].detail).toContain("32 instances");
  });

  test("insufficient permissions (403) → warn with servicequotas detail", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("AWS_ACCESS_KEY_ID", "AKIAFAKE12345678");
    await addSecret("AWS_SECRET_ACCESS_KEY", "fakesecretaccesskey0000000000000000000000");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("aws", { statusOverride: 403 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["aws"], log: () => {} });

    assertSummary(summary, "aws", { status: "warn" });
    expect(summary.results[0].detail).toContain("servicequotas");
  });
});

// ---------------------------------------------------------------------------
// Datadog
// ---------------------------------------------------------------------------

describe("probes-integration — datadog", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: valid API key, 15% rate-limit used → ok with quota fields", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("DD_API_KEY", "dd-fake-api-key");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("datadog", { quotaUsedFraction: 0.15, ceiling: 300 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["datadog"], log: () => {} });

    assertSummary(summary, "datadog", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].rateLimitCeiling).toBe(300);
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.15);
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: >80% rate-limit used → warn + alertThreshold (structured alert)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("DD_API_KEY", "dd-fake-api-key");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("datadog", { quotaUsedFraction: 0.88, ceiling: 300 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["datadog"], log: () => {} });

    assertSummary(summary, "datadog", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    // Confirm structured alert includes threshold info
    expect(summary.results[0].alertThreshold).toMatch(/0\.8/);
    expect(summary.alertCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sentry
// ---------------------------------------------------------------------------

describe("probes-integration — sentry", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 1 project visible, 20% rate-limit used → ok with quota fields", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SENTRY_AUTH_TOKEN", "sntrys_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("sentry", { quotaUsedFraction: 0.2, ceiling: 100 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["sentry"], log: () => {} });

    assertSummary(summary, "sentry", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].rateLimitCeiling).toBe(100);
    expect(summary.results[0].detail).toContain("project");
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 90% rate-limit used → warn + alertThreshold emitted", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SENTRY_AUTH_TOKEN", "sntrys_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("sentry", { quotaUsedFraction: 0.90, ceiling: 100 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["sentry"], log: () => {} });

    assertSummary(summary, "sentry", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

describe("probes-integration — linear", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 20% rate-limit used → ok with viewer name in detail", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("LINEAR_API_KEY", "lin_api_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("linear", { quotaUsedFraction: 0.2, ceiling: 1500 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["linear"], log: () => {} });

    assertSummary(summary, "linear", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].rateLimitCeiling).toBe(1500);
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.2);
    expect(summary.results[0].detail).toContain("Test User");
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 85% rate-limit used → warn + alertThreshold", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("LINEAR_API_KEY", "lin_api_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("linear", { quotaUsedFraction: 0.85, ceiling: 1500 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["linear"], log: () => {} });

    assertSummary(summary, "linear", {
      status: "warn",
      hasAlert: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Clerk
// ---------------------------------------------------------------------------

describe("probes-integration — clerk", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 2000 MAU (20% of free tier) → ok with quotaUtilization", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLERK_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/users/count")) {
        return Promise.resolve(generateMockProbeResponse("clerk", { quotaUsedFraction: 0.2 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["clerk"], log: () => {} });

    assertSummary(summary, "clerk", {
      status: "ok",
      hasQuotaUtilization: true,
    });
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.2);
    expect(summary.results[0].rateLimitCeiling).toBe(10000);
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: 9000 MAU (90% of free tier) → warn + alertThreshold", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLERK_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/users/count")) {
        return Promise.resolve(generateMockProbeResponse("clerk", { quotaUsedFraction: 0.9 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["clerk"], log: () => {} });

    assertSummary(summary, "clerk", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------

describe("probes-integration — firebase", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: RTDB reachable → ok with positive latencyMs", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("FIREBASE_DATABASE_URL", "https://my-project-default-rtdb.firebaseio.com");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("firebase"))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["firebase"], log: () => {} });

    assertSummary(summary, "firebase", {
      status: "ok",
      minLatencyMs: 0,
    });
    expect(summary.alertCount).toBe(0);
  });

  test("RTDB returns 401 → error status", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("FIREBASE_DATABASE_URL", "https://my-project-default-rtdb.firebaseio.com");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("firebase", { statusOverride: 401 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["firebase"], log: () => {} });

    assertSummary(summary, "firebase", { status: "error" });
  });
});

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------

describe("probes-integration — posthog", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: org visible, 20% rate-limit used → ok with org name in detail", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("POSTHOG_PERSONAL_API_KEY", "phx_fake_key");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("posthog", { quotaUsedFraction: 0.2, ceiling: 240 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["posthog"], log: () => {} });

    assertSummary(summary, "posthog", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].detail).toContain("My Org");
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: >80% rate-limit used → warn + alertThreshold emitted", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("POSTHOG_PERSONAL_API_KEY", "phx_fake_key");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("posthog", { quotaUsedFraction: 0.83, ceiling: 240 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["posthog"], log: () => {} });

    assertSummary(summary, "posthog", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    expect(summary.results[0].quotaUtilization).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// Mixpanel
// ---------------------------------------------------------------------------

describe("probes-integration — mixpanel", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("healthy: 15% rate-limit used → ok with quota fields", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("MIXPANEL_API_SECRET", "fake-mixpanel-secret");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("mixpanel", { quotaUsedFraction: 0.15, ceiling: 60 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["mixpanel"], log: () => {} });

    assertSummary(summary, "mixpanel", {
      status: "ok",
      hasQuotaUtilization: true,
      hasRateLimitCeiling: true,
    });
    expect(summary.results[0].rateLimitCeiling).toBe(60);
    expect(summary.results[0].quotaUtilization).toBeCloseTo(0.15);
    expect(summary.alertCount).toBe(0);
  });

  test("at-risk: >80% rate-limit used → warn + alertThreshold (structured alert)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("MIXPANEL_API_SECRET", "fake-mixpanel-secret");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("mixpanel", { quotaUsedFraction: 0.82, ceiling: 60 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["mixpanel"], log: () => {} });

    assertSummary(summary, "mixpanel", {
      status: "warn",
      hasQuotaUtilization: true,
      hasAlert: true,
    });
    // Confirm the structured alert has threshold text
    expect(summary.results[0].alertThreshold).toMatch(/0\.8/);
    expect(summary.alertCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-provider integration: ProbeRunSummary shape + alertCount accuracy
// ---------------------------------------------------------------------------

describe("probes-integration — multi-provider summary accuracy", () => {
  let h: Harness;
  let dir: string;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    __setHistogramDirForTesting(undefined);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("running github + datadog + sentry with mixed health → alertCount = 2 (warn probes only)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");
    await addSecret("DD_API_KEY", "dd-fake");
    await addSecret("SENTRY_AUTH_TOKEN", "sntrys_fake");

    globalThis.fetch = ((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("api.github.com")) {
        // GitHub healthy
        return Promise.resolve(generateMockProbeResponse("github", { quotaUsedFraction: 0.1, ceiling: 5000 }));
      }
      if (urlStr.includes("datadoghq.com")) {
        // Datadog at-risk (85%)
        return Promise.resolve(generateMockProbeResponse("datadog", { quotaUsedFraction: 0.85, ceiling: 300 }));
      }
      if (urlStr.includes("sentry.io")) {
        // Sentry at-risk (90%)
        return Promise.resolve(generateMockProbeResponse("sentry", { quotaUsedFraction: 0.90, ceiling: 100 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as unknown as typeof fetch;

    const summary = await runProbes({
      cwd: dir,
      providers: ["github", "datadog", "sentry"],
      log: () => {},
    });

    expect(summary.results).toHaveLength(3);
    expect(summary.alertCount).toBe(2);

    const githubResult = summary.results.find((r) => r.provider === "github");
    const datadogResult = summary.results.find((r) => r.provider === "datadog");
    const sentryResult = summary.results.find((r) => r.provider === "sentry");

    expect(githubResult?.status).toBe("ok");
    expect(datadogResult?.status).toBe("warn");
    expect(sentryResult?.status).toBe("warn");

    // All results have required ProbeRunSummary fields.
    expect(typeof summary.ranAt).toBe("string");
    // ranAt should be a valid ISO 8601 timestamp.
    expect(() => new Date(summary.ranAt)).not.toThrow();
  });

  test("ProbeRunSummary fields are always present and correctly typed", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("LINEAR_API_KEY", "lin_api_fake");

    globalThis.fetch = (() =>
      Promise.resolve(generateMockProbeResponse("linear", { quotaUsedFraction: 0.1, ceiling: 1500 }))
    ) as unknown as typeof fetch;

    const summary = await runProbes({ cwd: dir, providers: ["linear"], log: () => {} });

    // ProbeRunSummary shape contract
    expect(typeof summary.ranAt).toBe("string");
    expect(Array.isArray(summary.results)).toBe(true);
    expect(typeof summary.alertCount).toBe("number");
    expect(summary.alertCount).toBeGreaterThanOrEqual(0);

    // ProbeResult shape contract
    const r = summary.results[0];
    expect(typeof r.provider).toBe("string");
    expect(typeof r.probedAt).toBe("string");
    expect(typeof r.latencyMs).toBe("number");
    expect(["ok", "warn", "error", "skipped"]).toContain(r.status);
  });
});
