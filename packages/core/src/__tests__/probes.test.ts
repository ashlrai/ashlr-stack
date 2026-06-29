/**
 * Provider Health Check Probe Suite — tests.
 *
 * Covers:
 *   1. Quota parsing + alert threshold detection for each probe.
 *   2. Histogram persistence (appendSample, pruning, percentiles).
 *   3. ProbeRunSummary: alertCount, enrichment with p50/p95.
 *   4. Skipped status when credentials are absent.
 *   5. Error status on non-2xx responses.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetPhantomCache } from "../phantom.ts";
import {
  __setHistogramDirForTesting,
  appendSample,
  computePercentiles,
  readHistogram,
  runProbes,
  writeHistogram,
} from "../probes/index.ts";
import type { HistogramStore, Probe, ProbeResult } from "../probes/types.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown, headers?: Record<string, string>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    })) as unknown as typeof fetch;
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "stack-probes-"));
}

// ---------------------------------------------------------------------------
// Histogram persistence
// ---------------------------------------------------------------------------

describe("histogram — persistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
  });

  afterEach(() => {
    __setHistogramDirForTesting(undefined);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("readHistogram returns empty object when file absent", async () => {
    const store = await readHistogram("/nonexistent-cwd-12345");
    expect(store).toEqual({});
  });

  test("writeHistogram + readHistogram round-trips correctly", async () => {
    const sample: HistogramStore = {
      github: [
        { ts: Date.now(), latencyMs: 42, status: "ok" },
        { ts: Date.now() - 1000, latencyMs: 60, status: "ok" },
      ],
    };
    await writeHistogram("/unused-cwd", sample);
    const loaded = await readHistogram("/unused-cwd");
    expect(loaded.github).toHaveLength(2);
    expect(loaded.github![0].latencyMs).toBe(42);
  });

  test("appendSample adds sample and persists", async () => {
    await appendSample("/unused-cwd", "openai", {
      ts: Date.now(),
      latencyMs: 100,
      status: "ok",
    });
    const store = await readHistogram("/unused-cwd");
    expect(store.openai).toHaveLength(1);
    expect(store.openai![0].latencyMs).toBe(100);
  });

  test("appendSample prunes samples older than 7 days", async () => {
    const OLD_MS = 8 * 24 * 60 * 60 * 1_000; // 8 days ago
    await writeHistogram("/unused-cwd", {
      github: [{ ts: Date.now() - OLD_MS, latencyMs: 999, status: "ok" }],
    });
    await appendSample("/unused-cwd", "github", {
      ts: Date.now(),
      latencyMs: 50,
      status: "ok",
    });
    const store = await readHistogram("/unused-cwd");
    // Old sample should be pruned, only new one survives.
    expect(store.github).toHaveLength(1);
    expect(store.github![0].latencyMs).toBe(50);
  });

  test("appendSample keeps samples within 7 days", async () => {
    const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1_000;
    await writeHistogram("/unused-cwd", {
      github: [{ ts: Date.now() - SIX_DAYS_MS, latencyMs: 200, status: "ok" }],
    });
    await appendSample("/unused-cwd", "github", {
      ts: Date.now(),
      latencyMs: 50,
      status: "ok",
    });
    const store = await readHistogram("/unused-cwd");
    expect(store.github).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Percentile computation
// ---------------------------------------------------------------------------

describe("histogram — percentiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
    __setHistogramDirForTesting(dir);
  });

  afterEach(() => {
    __setHistogramDirForTesting(undefined);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("computePercentiles returns undefined when no samples", async () => {
    const store = await readHistogram("/unused-cwd");
    const { p50Ms, p95Ms } = computePercentiles(store, "github");
    expect(p50Ms).toBeUndefined();
    expect(p95Ms).toBeUndefined();
  });

  test("computePercentiles correct for single sample", async () => {
    const store: HistogramStore = {
      github: [{ ts: Date.now(), latencyMs: 77, status: "ok" }],
    };
    const { p50Ms, p95Ms } = computePercentiles(store, "github");
    expect(p50Ms).toBe(77);
    expect(p95Ms).toBe(77);
  });

  test("computePercentiles correct for [10, 20, 30, 40, 100]", async () => {
    const store: HistogramStore = {
      openai: [10, 20, 30, 40, 100].map((latencyMs) => ({
        ts: Date.now(),
        latencyMs,
        status: "ok" as const,
      })),
    };
    const { p50Ms, p95Ms } = computePercentiles(store, "openai");
    expect(p50Ms).toBe(30); // median of 5 → index 2 (ceil(2.5)-1 = 2)
    expect(p95Ms).toBe(100); // ceil(4.75)-1 = 4 → 100
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — GitHub
// ---------------------------------------------------------------------------

describe("probe-github", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when GITHUB_TOKEN absent", async () => {
    const { default: probe } = await import("../probes/probe-github.ts");
    const result = await probe.run({ log: () => {} });
    expect(result.status).toBe("skipped");
    expect(result.latencyMs).toBe(0);
  });

  test("returns ok with quota utilization when API succeeds", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = mockFetch(200, {
      resources: { core: { limit: 5000, remaining: 4000, used: 1000 } },
    });

    const { default: probe } = await import("../probes/probe-github.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.rateLimitCeiling).toBe(5000);
    expect(result.quotaUtilization).toBeCloseTo(0.2);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("returns warn when utilization >= 0.80", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = mockFetch(200, {
      resources: { core: { limit: 5000, remaining: 900, used: 4100 } },
    });

    const { default: probe } = await import("../probes/probe-github.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
    expect(result.alertThreshold).toBeDefined();
  });

  test("returns error when utilization >= 0.95", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = mockFetch(200, {
      resources: { core: { limit: 5000, remaining: 100, used: 4900 } },
    });

    const { default: probe } = await import("../probes/probe-github.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
    expect(result.alertThreshold).toContain("0.95");
  });

  test("returns error on non-200 response", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("GITHUB_TOKEN", "ghp_fake");

    globalThis.fetch = mockFetch(401, { message: "Bad credentials" });

    const { default: probe } = await import("../probes/probe-github.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
    expect(result.detail).toContain("401");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — OpenAI
// ---------------------------------------------------------------------------

describe("probe-openai", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when OPENAI_API_KEY absent", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { default: probe } = await import("../probes/probe-openai.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  test("returns ok and parses rate-limit token headers", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("OPENAI_API_KEY", "sk-fake-openai");

    // Mock /v1/models with rate-limit headers; billing call will fail gracefully.
    let callCount = 0;
    globalThis.fetch = (async (_url: unknown) => {
      callCount++;
      const url = String(_url);
      if (url.includes("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), {
          status: 200,
          headers: {
            "x-ratelimit-limit-tokens": "90000",
            "x-ratelimit-remaining-tokens": "81000",
            "Content-Type": "application/json",
          },
        });
      }
      // Billing call — 403 to test graceful degradation.
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-openai.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.rateLimitCeiling).toBe(90000);
    expect(result.quotaUtilization).toBeCloseTo(0.1);
    // estimatedDailyBurnUSD should be absent since billing call returned 403.
    expect(result.estimatedDailyBurnUSD).toBeUndefined();
  });

  test("parses billing endpoint spend", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("OPENAI_API_KEY", "sk-fake-openai");

    globalThis.fetch = (async (_url: unknown) => {
      const url = String(_url);
      if (url.includes("/v1/models")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Billing response: 500 cents = $5.00
      return new Response(JSON.stringify({ total_usage: 500 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-openai.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.estimatedDailyBurnUSD).toBeCloseTo(5.0);
  });

  test("returns error on 401", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("OPENAI_API_KEY", "sk-fake-openai");

    globalThis.fetch = mockFetch(401, { error: { code: "invalid_api_key" } });

    const { default: probe } = await import("../probes/probe-openai.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
    expect(result.detail).toContain("401");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Anthropic
// ---------------------------------------------------------------------------

describe("probe-anthropic", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when ANTHROPIC_API_KEY absent", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { default: probe } = await import("../probes/probe-anthropic.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  test("returns ok and parses anthropic rate-limit headers", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("ANTHROPIC_API_KEY", "sk-ant-fake");

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "claude-opus-4-5" }] }), {
        status: 200,
        headers: {
          "anthropic-ratelimit-tokens-limit": "100000",
          "anthropic-ratelimit-tokens-remaining": "60000",
          "Content-Type": "application/json",
        },
      })) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-anthropic.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.rateLimitCeiling).toBe(100000);
    expect(result.quotaUtilization).toBeCloseTo(0.4);
  });

  test("warns at >= 80% token utilization", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("ANTHROPIC_API_KEY", "sk-ant-fake");

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          "anthropic-ratelimit-tokens-limit": "100000",
          "anthropic-ratelimit-tokens-remaining": "15000",
          "Content-Type": "application/json",
        },
      })) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-anthropic.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
    expect(result.alertThreshold).toBeDefined();
  });

  test("returns error on 401", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("ANTHROPIC_API_KEY", "sk-ant-fake");

    globalThis.fetch = mockFetch(401, { error: { type: "authentication_error" } });

    const { default: probe } = await import("../probes/probe-anthropic.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Stripe
// ---------------------------------------------------------------------------

describe("probe-stripe", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when STRIPE_SECRET_KEY absent", async () => {
    const prev = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const { default: probe } = await import("../probes/probe-stripe.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.STRIPE_SECRET_KEY = prev;
    }
  });

  test("returns ok when no open disputes", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = mockFetch(200, { data: [], has_more: false });

    const { default: probe } = await import("../probes/probe-stripe.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("0 open dispute");
  });

  test("returns warn when open disputes exist", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = mockFetch(200, {
      data: [{ id: "dp_1", status: "needs_response", amount: 5000 }],
      has_more: false,
    });

    const { default: probe } = await import("../probes/probe-stripe.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
    expect(result.alertThreshold).toContain("dispute");
    expect(result.detail).toContain("1");
  });

  test("parses rate-limit headers when present", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          "ratelimit-limit": "100",
          "ratelimit-remaining": "15",
          "Content-Type": "application/json",
        },
      })) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-stripe.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.rateLimitCeiling).toBe(100);
    expect(result.quotaUtilization).toBeCloseTo(0.85);
    expect(result.status).toBe("warn");
  });

  test("returns error on non-200 response", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("STRIPE_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = mockFetch(401, { error: { type: "invalid_request_error" } });

    const { default: probe } = await import("../probes/probe-stripe.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Vercel
// ---------------------------------------------------------------------------

describe("probe-vercel", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when VERCEL_TOKEN absent", async () => {
    const prev = process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TOKEN;
    try {
      const { default: probe } = await import("../probes/probe-vercel.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.VERCEL_TOKEN = prev;
    }
  });

  test("returns ok and parses build minutes", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");
    await addSecret("VERCEL_TEAM_ID", "team_fake");

    globalThis.fetch = (async (_url: unknown) => {
      const url = String(_url);
      if (url.includes("/usage")) {
        return new Response(
          JSON.stringify({
            buildMinutesUsed: 1200,
            buildMinutesAllowed: 6000,
            functionExecutionUnitsUsed: 20000,
            functionExecutionUnitsAllowed: 100000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-vercel.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.quotaUtilization).toBeCloseTo(0.2); // max(1200/6000, 20000/100000) = 0.2
  });

  test("warns when build minutes utilization >= 80%", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");
    await addSecret("VERCEL_TEAM_ID", "team_fake");

    globalThis.fetch = (async (_url: unknown) => {
      const url = String(_url);
      if (url.includes("/usage")) {
        return new Response(
          JSON.stringify({
            buildMinutesUsed: 5000,
            buildMinutesAllowed: 6000,
            functionExecutionUnitsUsed: 0,
            functionExecutionUnitsAllowed: 100000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-vercel.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
    expect(result.alertThreshold).toBeDefined();
  });

  test("returns error on non-200 usage response", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("VERCEL_TOKEN", "vercel-fake-token");
    await addSecret("VERCEL_TEAM_ID", "team_fake");

    globalThis.fetch = (async (_url: unknown) => {
      const url = String(_url);
      if (url.includes("/usage")) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-vercel.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Supabase
// ---------------------------------------------------------------------------

describe("probe-supabase", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when access token absent", async () => {
    const prev1 = process.env.SUPABASE_ACCESS_TOKEN;
    const prev2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ACCESS_TOKEN;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const { default: probe } = await import("../probes/probe-supabase.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev1 !== undefined) process.env.SUPABASE_ACCESS_TOKEN = prev1;
      if (prev2 !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prev2;
    }
  });

  test("returns skipped when project ref cannot be resolved", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ACCESS_TOKEN", "sbp_fake");

    const { default: probe } = await import("../probes/probe-supabase.ts");
    const result = await probe.run({ log: () => {} });
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("project ref");
  });

  test("returns ok with db size metric", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ACCESS_TOKEN", "sbp_fake");
    await addSecret("SUPABASE_PROJECT_REF", "abcdefghijklmnop");

    globalThis.fetch = mockFetch(200, {
      usages: [
        { metric: "db_size", usage: 100 * 1024 * 1024, limit: 500 * 1024 * 1024, available: 400 * 1024 * 1024 },
      ],
    });

    const { default: probe } = await import("../probes/probe-supabase.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.quotaUtilization).toBeCloseTo(0.2);
    expect(result.detail).toContain("100.0 MB");
  });

  test("warns when db size near limit", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ACCESS_TOKEN", "sbp_fake");
    await addSecret("SUPABASE_PROJECT_REF", "abcdefghijklmnop");

    globalThis.fetch = mockFetch(200, {
      usages: [
        { metric: "db_size", usage: 460 * 1024 * 1024, limit: 500 * 1024 * 1024, available: 40 * 1024 * 1024 },
      ],
    });

    const { default: probe } = await import("../probes/probe-supabase.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
    expect(result.alertThreshold).toBeDefined();
  });

  test("extracts project ref from SUPABASE_URL", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("SUPABASE_ACCESS_TOKEN", "sbp_fake");
    await addSecret("SUPABASE_URL", "https://myprojectref.supabase.co");

    globalThis.fetch = mockFetch(200, { usages: [] });

    const { default: probe } = await import("../probes/probe-supabase.ts");
    const result = await probe.run({ log: () => {} });

    // Should reach the API (not skipped) because ref was extracted from URL.
    expect(result.status).not.toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Neon
// ---------------------------------------------------------------------------

describe("probe-neon", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when NEON_API_KEY absent", async () => {
    const prev = process.env.NEON_API_KEY;
    delete process.env.NEON_API_KEY;
    try {
      const { default: probe } = await import("../probes/probe-neon.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.NEON_API_KEY = prev;
    }
  });

  test("returns ok with branch count and compute hours", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon-fake-token");
    await addSecret("NEON_PROJECT_ID", "proj-fake");

    globalThis.fetch = (async (_url: unknown) => {
      const url = String(_url);
      if (url.includes("/branches")) {
        return new Response(
          JSON.stringify({
            branches: [
              { id: "br-1", name: "main", compute_time_seconds: 3600 },
              { id: "br-2", name: "dev", compute_time_seconds: 1800 },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ projects: [{ id: "proj-fake" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-neon.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("2 branch");
    expect(result.detail).toContain("1.5h");
  });

  test("warns at >= 80% compute utilization", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("NEON_API_KEY", "neon-fake-token");
    await addSecret("NEON_PROJECT_ID", "proj-fake");

    // 191.9h free tier * 0.85 = ~163h = ~587,160 seconds
    const computeSeconds = Math.floor(191.9 * 3600 * 0.85);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          branches: [{ id: "br-1", name: "main", compute_time_seconds: computeSeconds }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-neon.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Clerk
// ---------------------------------------------------------------------------

describe("probe-clerk", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when CLERK_SECRET_KEY absent", async () => {
    const prev = process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_SECRET_KEY;
    try {
      const { default: probe } = await import("../probes/probe-clerk.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.CLERK_SECRET_KEY = prev;
    }
  });

  test("returns ok with MAU utilization", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLERK_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = (async (_url: unknown) => {
      const url = String(_url);
      if (url.includes("/users/count")) {
        return new Response(JSON.stringify({ object: "total_count", total_count: 2000 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Instance call — fail gracefully.
      return new Response(JSON.stringify({ id: "ins_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-clerk.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.quotaUtilization).toBeCloseTo(0.2); // 2000/10000
    expect(result.rateLimitCeiling).toBe(10000);
  });

  test("warns at >= 80% MAU", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLERK_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = (async (_url: unknown) => {
      const url = String(_url);
      if (url.includes("/users/count")) {
        return new Response(JSON.stringify({ total_count: 8500 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-clerk.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
    expect(result.alertThreshold).toBeDefined();
  });

  test("returns error on 401", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("CLERK_SECRET_KEY", "sk_test_fake");

    globalThis.fetch = mockFetch(401, { errors: [{ code: "authentication_invalid" }] });

    const { default: probe } = await import("../probes/probe-clerk.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Linear
// ---------------------------------------------------------------------------

describe("probe-linear", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when LINEAR_API_KEY absent", async () => {
    const prev = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;
    try {
      const { default: probe } = await import("../probes/probe-linear.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.LINEAR_API_KEY = prev;
    }
  });

  test("returns ok and parses rate-limit headers", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("LINEAR_API_KEY", "lin_api_fake");

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { viewer: { id: "u1", name: "Mason" } } }), {
        status: 200,
        headers: {
          "x-ratelimit-limit": "1500",
          "x-ratelimit-remaining": "1200",
          "Content-Type": "application/json",
        },
      })) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-linear.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.rateLimitCeiling).toBe(1500);
    expect(result.quotaUtilization).toBeCloseTo(0.2);
    expect(result.detail).toContain("Mason");
  });

  test("warns at >= 80% rate-limit utilization", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("LINEAR_API_KEY", "lin_api_fake");

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { viewer: { id: "u1", name: "Mason" } } }), {
        status: 200,
        headers: {
          "x-ratelimit-limit": "1500",
          "x-ratelimit-remaining": "200",
          "Content-Type": "application/json",
        },
      })) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-linear.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
  });

  test("returns error on non-200", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("LINEAR_API_KEY", "lin_api_fake");

    globalThis.fetch = mockFetch(429, { errors: [{ message: "rate limited" }] });

    const { default: probe } = await import("../probes/probe-linear.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — AWS
// ---------------------------------------------------------------------------

describe("probe-aws", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when AWS credentials absent", async () => {
    const prevId = process.env.AWS_ACCESS_KEY_ID;
    const prevSecret = process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    try {
      const { default: probe } = await import("../probes/probe-aws.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prevId !== undefined) process.env.AWS_ACCESS_KEY_ID = prevId;
      if (prevSecret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = prevSecret;
    }
  });

  test("returns ok with EC2 quota on success", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("AWS_ACCESS_KEY_ID", "AKIAFAKE12345678");
    await addSecret("AWS_SECRET_ACCESS_KEY", "fakesecretaccesskey0000000000000000000000");

    globalThis.fetch = mockFetch(200, {
      Quota: {
        QuotaName: "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances",
        Value: 32,
        ServiceCode: "ec2",
        QuotaCode: "L-1216C47A",
      },
    });

    const { default: probe } = await import("../probes/probe-aws.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.rateLimitCeiling).toBe(32);
    expect(result.detail).toContain("32 instances");
  });

  test("returns warn when permissions insufficient (403)", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("AWS_ACCESS_KEY_ID", "AKIAFAKE12345678");
    await addSecret("AWS_SECRET_ACCESS_KEY", "fakesecretaccesskey0000000000000000000000");

    globalThis.fetch = mockFetch(403, { message: "User is not authorized" });

    const { default: probe } = await import("../probes/probe-aws.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("servicequotas");
  });

  test("returns error on unexpected API error", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret("AWS_ACCESS_KEY_ID", "AKIAFAKE12345678");
    await addSecret("AWS_SECRET_ACCESS_KEY", "fakesecretaccesskey0000000000000000000000");

    globalThis.fetch = mockFetch(500, { message: "Internal Server Error" });

    const { default: probe } = await import("../probes/probe-aws.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Individual probe tests — Firebase
// ---------------------------------------------------------------------------

describe("probe-firebase", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns skipped when FIREBASE_DATABASE_URL absent", async () => {
    const prev = process.env.FIREBASE_DATABASE_URL;
    delete process.env.FIREBASE_DATABASE_URL;
    try {
      const { default: probe } = await import("../probes/probe-firebase.ts");
      const result = await probe.run({ log: () => {} });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.FIREBASE_DATABASE_URL = prev;
    }
  });

  test("returns ok for reachable RTDB", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret(
      "FIREBASE_DATABASE_URL",
      "https://my-project-default-rtdb.firebaseio.com",
    );

    globalThis.fetch = (async () =>
      new Response("0", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const { default: probe } = await import("../probes/probe-firebase.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("returns error when RTDB unreachable", async () => {
    const { addSecret } = await import("../phantom.ts");
    await addSecret(
      "FIREBASE_DATABASE_URL",
      "https://my-project-default-rtdb.firebaseio.com",
    );

    globalThis.fetch = mockFetch(401, { error: "Permission denied" });

    const { default: probe } = await import("../probes/probe-firebase.ts");
    const result = await probe.run({ log: () => {} });

    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// runProbes integration — summary alertCount + percentile enrichment
// ---------------------------------------------------------------------------

describe("runProbes — integration", () => {
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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("runProbes with custom extraProbes returns correct summary shape", async () => {
    const fakeProbe: Probe = {
      provider: "fake-provider",
      label: "Fake probe for tests",
      async run(): Promise<ProbeResult> {
        return {
          provider: "fake-provider",
          probedAt: new Date().toISOString(),
          latencyMs: 42,
          status: "ok",
          detail: "all good",
        };
      },
    };

    const summary = await runProbes({
      cwd: dir,
      providers: ["fake-provider"],
      extraProbes: [fakeProbe],
      log: () => {},
    });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].provider).toBe("fake-provider");
    expect(summary.results[0].status).toBe("ok");
    expect(summary.alertCount).toBe(0);
    expect(typeof summary.ranAt).toBe("string");
  });

  test("runProbes alertCount counts warn+error but not skipped/ok", async () => {
    const probes: Probe[] = [
      {
        provider: "p-ok",
        label: "ok probe",
        async run(): Promise<ProbeResult> {
          return { provider: "p-ok", probedAt: new Date().toISOString(), latencyMs: 1, status: "ok" };
        },
      },
      {
        provider: "p-warn",
        label: "warn probe",
        async run(): Promise<ProbeResult> {
          return { provider: "p-warn", probedAt: new Date().toISOString(), latencyMs: 1, status: "warn", detail: "high usage" };
        },
      },
      {
        provider: "p-error",
        label: "error probe",
        async run(): Promise<ProbeResult> {
          return { provider: "p-error", probedAt: new Date().toISOString(), latencyMs: 1, status: "error", detail: "failed" };
        },
      },
      {
        provider: "p-skipped",
        label: "skipped probe",
        async run(): Promise<ProbeResult> {
          return { provider: "p-skipped", probedAt: new Date().toISOString(), latencyMs: 0, status: "skipped" };
        },
      },
    ];

    const summary = await runProbes({
      cwd: dir,
      providers: ["p-ok", "p-warn", "p-error", "p-skipped"],
      extraProbes: probes,
      log: () => {},
    });

    expect(summary.alertCount).toBe(2);
    expect(summary.results).toHaveLength(4);
  });

  test("runProbes enriches results with p50Ms and p95Ms after multiple runs", async () => {
    const probe: Probe = {
      provider: "latency-test",
      label: "latency test",
      async run(): Promise<ProbeResult> {
        return {
          provider: "latency-test",
          probedAt: new Date().toISOString(),
          latencyMs: 100,
          status: "ok",
        };
      },
    };

    // First run: single sample.
    await runProbes({ cwd: dir, providers: ["latency-test"], extraProbes: [probe], log: () => {} });

    // Second run with a different latency by replacing the probe.
    const probe2: Probe = {
      provider: "latency-test",
      label: "latency test",
      async run(): Promise<ProbeResult> {
        return {
          provider: "latency-test",
          probedAt: new Date().toISOString(),
          latencyMs: 200,
          status: "ok",
        };
      },
    };
    const summary = await runProbes({
      cwd: dir,
      providers: ["latency-test"],
      extraProbes: [probe2],
      log: () => {},
    });

    const result = summary.results[0];
    // After 2 samples (100ms + 200ms), p50 = 100 (ceil(1)-1=0), p95 = 200 (ceil(1.9)-1=1).
    expect(result.p50Ms).toBeDefined();
    expect(result.p95Ms).toBeDefined();
    expect(typeof result.p50Ms).toBe("number");
  });

  test("runProbes handles thrown probe gracefully", async () => {
    const badProbe: Probe = {
      provider: "bad-probe",
      label: "bad probe",
      async run(): Promise<ProbeResult> {
        throw new Error("unexpected error in probe");
      },
    };

    const summary = await runProbes({
      cwd: dir,
      providers: ["bad-probe"],
      extraProbes: [badProbe],
      log: () => {},
    });

    expect(summary.results[0].status).toBe("error");
    expect(summary.results[0].detail).toContain("unexpected error in probe");
  });

  test("runProbes filters to selected providers only", async () => {
    const p1: Probe = {
      provider: "provider-a",
      label: "a",
      async run(): Promise<ProbeResult> {
        return { provider: "provider-a", probedAt: new Date().toISOString(), latencyMs: 1, status: "ok" };
      },
    };
    const p2: Probe = {
      provider: "provider-b",
      label: "b",
      async run(): Promise<ProbeResult> {
        return { provider: "provider-b", probedAt: new Date().toISOString(), latencyMs: 1, status: "ok" };
      },
    };

    const summary = await runProbes({
      cwd: dir,
      providers: ["provider-a"],
      extraProbes: [p1, p2],
      log: () => {},
    });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].provider).toBe("provider-a");
  });
});
