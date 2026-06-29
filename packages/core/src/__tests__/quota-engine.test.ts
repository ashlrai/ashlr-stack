/**
 * QuotaEngine — unit + integration tests.
 *
 * Covers:
 *   1. `probeResultToSnapshot` — field mapping + defaults.
 *   2. `QuotaEngine.computePercentile` — p50/p95 accuracy.
 *   3. `QuotaEngine.computeLatencyPercentiles` — histogram integration.
 *   4. `QuotaEngine.computeBurnTrend` — rolling window, slope, empty case.
 *   5. `QuotaEngine.detectAlert` — utilization threshold, burn budget, both.
 *   6. `QuotaEngine.aggregate` — multi-provider aggregation, stack utilization,
 *      monthly spend, top spenders, alert count.
 *   7. `buildForecast` — skipped probes excluded, end-to-end shape.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QuotaEngine,
  buildForecast,
  probeResultToSnapshot,
  type QuotaSnapshot,
} from "../quota-engine.ts";
import {
  __setHistogramDirForTesting,
  writeHistogram,
} from "../probes/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "stack-quota-engine-"));
}

function makeSnapshot(
  provider: string,
  overrides: Partial<QuotaSnapshot> = {},
): QuotaSnapshot {
  return {
    provider,
    snapshotAt: new Date().toISOString(),
    latencyMs: 50,
    quotaUsedPercent: 0,
    rateLimitRemaining: 1000,
    estimatedDailyBurnUSD: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. probeResultToSnapshot
// ---------------------------------------------------------------------------

describe("probeResultToSnapshot", () => {
  test("maps ProbeResult fields correctly", () => {
    const result = {
      provider: "openai",
      probedAt: "2026-06-01T00:00:00.000Z",
      latencyMs: 120,
      quotaUtilization: 0.45,
      rateLimitRemaining: 55000,
      estimatedDailyBurnUSD: 3.5,
      p50Ms: 100,
      p95Ms: 200,
      status: "ok" as const,
    };

    const snap = probeResultToSnapshot(result);

    expect(snap.provider).toBe("openai");
    expect(snap.snapshotAt).toBe(result.probedAt);
    expect(snap.latencyMs).toBe(120);
    expect(snap.quotaUsedPercent).toBeCloseTo(45);
    expect(snap.rateLimitRemaining).toBe(55000);
    expect(snap.estimatedDailyBurnUSD).toBe(3.5);
    expect(snap.p50Ms).toBe(100);
    expect(snap.p95Ms).toBe(200);
  });

  test("defaults to 0 when optional fields are absent", () => {
    const snap = probeResultToSnapshot({
      provider: "github",
      probedAt: new Date().toISOString(),
      latencyMs: 80,
      status: "ok",
    });

    expect(snap.quotaUsedPercent).toBe(0);
    expect(snap.rateLimitRemaining).toBe(0);
    expect(snap.estimatedDailyBurnUSD).toBe(0);
    expect(snap.p50Ms).toBeUndefined();
    expect(snap.p95Ms).toBeUndefined();
  });

  test("converts quotaUtilization fraction to percent", () => {
    const snap = probeResultToSnapshot({
      provider: "stripe",
      probedAt: new Date().toISOString(),
      latencyMs: 30,
      quotaUtilization: 0.82,
      status: "warn",
    });
    expect(snap.quotaUsedPercent).toBeCloseTo(82);
  });
});

// ---------------------------------------------------------------------------
// 2. QuotaEngine.computePercentile
// ---------------------------------------------------------------------------

describe("QuotaEngine.computePercentile", () => {
  const engine = new QuotaEngine();

  test("returns undefined for empty array", () => {
    expect(engine.computePercentile([], 50)).toBeUndefined();
  });

  test("p50 of single element returns that element", () => {
    expect(engine.computePercentile([42], 50)).toBe(42);
  });

  test("p50 of [10, 20, 30, 40, 100] is 30", () => {
    expect(engine.computePercentile([10, 20, 30, 40, 100], 50)).toBe(30);
  });

  test("p95 of [10, 20, 30, 40, 100] is 100", () => {
    expect(engine.computePercentile([10, 20, 30, 40, 100], 95)).toBe(100);
  });

  test("p100 returns maximum value", () => {
    expect(engine.computePercentile([5, 15, 25], 100)).toBe(25);
  });

  test("works on unsorted input", () => {
    expect(engine.computePercentile([100, 10, 50], 50)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 3. QuotaEngine.computeLatencyPercentiles
// ---------------------------------------------------------------------------

describe("QuotaEngine.computeLatencyPercentiles", () => {
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

  test("returns undefined when provider has no samples", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const store = await engine.loadHistogram();
    const { p50Ms, p95Ms } = engine.computeLatencyPercentiles(store, "github");
    expect(p50Ms).toBeUndefined();
    expect(p95Ms).toBeUndefined();
  });

  test("computes correct p50/p95 from histogram store", async () => {
    await writeHistogram("/unused-cwd", {
      openai: [20, 40, 60, 80, 200].map((latencyMs) => ({
        ts: Date.now(),
        latencyMs,
        status: "ok" as const,
      })),
    });

    const engine = new QuotaEngine({ cwd: dir });
    const store = await engine.loadHistogram();
    const { p50Ms, p95Ms } = engine.computeLatencyPercentiles(store, "openai");

    expect(p50Ms).toBe(60);  // median of 5 → index 2
    expect(p95Ms).toBe(200); // ceil(4.75)-1 = 4
  });
});

// ---------------------------------------------------------------------------
// 4. QuotaEngine.computeBurnTrend
// ---------------------------------------------------------------------------

describe("QuotaEngine.computeBurnTrend", () => {
  test("returns zero trend when provider has no samples", async () => {
    const engine = new QuotaEngine();
    const trend = engine.computeBurnTrend({}, "openai");
    expect(trend.avgDailyBurnUSD).toBe(0);
    expect(trend.sampleCount).toBe(0);
    expect(trend.slopeDailyUSD).toBe(0);
  });

  test("returns zero trend when no burn samples (all undefined)", async () => {
    const engine = new QuotaEngine();
    const store = {
      stripe: [
        { ts: Date.now(), latencyMs: 50, status: "ok" as const },
        { ts: Date.now() - 1000, latencyMs: 60, status: "ok" as const },
      ],
    };
    const trend = engine.computeBurnTrend(store, "stripe");
    expect(trend.avgDailyBurnUSD).toBe(0);
    expect(trend.sampleCount).toBe(0);
  });

  test("computes correct average with flat burn samples", async () => {
    const engine = new QuotaEngine();
    const store = {
      openai: [
        { ts: Date.now() - 3000, latencyMs: 100, estimatedDailyBurnUSD: 5, status: "ok" as const },
        { ts: Date.now() - 2000, latencyMs: 110, estimatedDailyBurnUSD: 5, status: "ok" as const },
        { ts: Date.now() - 1000, latencyMs: 90,  estimatedDailyBurnUSD: 5, status: "ok" as const },
      ],
    };
    const trend = engine.computeBurnTrend(store, "openai");
    expect(trend.avgDailyBurnUSD).toBeCloseTo(5);
    expect(trend.sampleCount).toBe(3);
    // Flat series → slope ≈ 0
    expect(Math.abs(trend.slopeDailyUSD)).toBeCloseTo(0, 5);
  });

  test("slope is positive when burn is accelerating", async () => {
    const engine = new QuotaEngine();
    const store = {
      anthropic: [
        { ts: Date.now() - 3000, latencyMs: 80, estimatedDailyBurnUSD: 1, status: "ok" as const },
        { ts: Date.now() - 2000, latencyMs: 80, estimatedDailyBurnUSD: 3, status: "ok" as const },
        { ts: Date.now() - 1000, latencyMs: 80, estimatedDailyBurnUSD: 8, status: "ok" as const },
      ],
    };
    const trend = engine.computeBurnTrend(store, "anthropic");
    expect(trend.slopeDailyUSD).toBeGreaterThan(0);
  });

  test("slope is negative when burn is decelerating", async () => {
    const engine = new QuotaEngine();
    const store = {
      aws: [
        { ts: Date.now() - 3000, latencyMs: 100, estimatedDailyBurnUSD: 10, status: "ok" as const },
        { ts: Date.now() - 2000, latencyMs: 100, estimatedDailyBurnUSD: 5,  status: "ok" as const },
        { ts: Date.now() - 1000, latencyMs: 100, estimatedDailyBurnUSD: 2,  status: "ok" as const },
      ],
    };
    const trend = engine.computeBurnTrend(store, "aws");
    expect(trend.slopeDailyUSD).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. QuotaEngine.detectAlert
// ---------------------------------------------------------------------------

describe("QuotaEngine.detectAlert", () => {
  test("returns undefined when both thresholds are clear", () => {
    const engine = new QuotaEngine({ utilizationThresholdPct: 75, budgetDailyUSD: 100 });
    const alert = engine.detectAlert(makeSnapshot("github", { quotaUsedPercent: 50, estimatedDailyBurnUSD: 10 }));
    expect(alert).toBeUndefined();
  });

  test("flags utilization when >= threshold (default 75)", () => {
    const engine = new QuotaEngine({ utilizationThresholdPct: 75 });
    const alert = engine.detectAlert(makeSnapshot("openai", { quotaUsedPercent: 80 }));
    expect(alert).toBeDefined();
    expect(alert!.reason).toBe("utilization");
    expect(alert!.quotaUsedPercent).toBe(80);
  });

  test("flags utilization at exactly the threshold", () => {
    const engine = new QuotaEngine({ utilizationThresholdPct: 75 });
    const alert = engine.detectAlert(makeSnapshot("stripe", { quotaUsedPercent: 75 }));
    expect(alert).toBeDefined();
    expect(alert!.reason).toBe("utilization");
  });

  test("flags burn when daily burn > budget", () => {
    const engine = new QuotaEngine({ budgetDailyUSD: 20 });
    const alert = engine.detectAlert(makeSnapshot("anthropic", { estimatedDailyBurnUSD: 25 }));
    expect(alert).toBeDefined();
    expect(alert!.reason).toBe("burn");
    expect(alert!.budgetDailyUSD).toBe(20);
    expect(alert!.estimatedDailyBurnUSD).toBe(25);
  });

  test("does not flag burn when no budget is set", () => {
    const engine = new QuotaEngine(); // no budget
    const alert = engine.detectAlert(makeSnapshot("openai", { estimatedDailyBurnUSD: 999 }));
    // Only utilization threshold applies; quotaUsedPercent defaults to 0
    expect(alert).toBeUndefined();
  });

  test("flags both reasons when both thresholds crossed", () => {
    const engine = new QuotaEngine({ utilizationThresholdPct: 75, budgetDailyUSD: 10 });
    const alert = engine.detectAlert(
      makeSnapshot("aws", { quotaUsedPercent: 90, estimatedDailyBurnUSD: 15 }),
    );
    expect(alert).toBeDefined();
    expect(alert!.reason).toBe("both");
  });

  test("respects custom utilizationThresholdPct", () => {
    const engine = new QuotaEngine({ utilizationThresholdPct: 50 });
    const alert = engine.detectAlert(makeSnapshot("vercel", { quotaUsedPercent: 60 }));
    expect(alert).toBeDefined();
    // Would NOT alert with default threshold of 75:
    const engineDefault = new QuotaEngine();
    const noAlert = engineDefault.detectAlert(makeSnapshot("vercel", { quotaUsedPercent: 60 }));
    expect(noAlert).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. QuotaEngine.aggregate — multi-provider aggregation
// ---------------------------------------------------------------------------

describe("QuotaEngine.aggregate", () => {
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

  test("returns a forecast with correct shape for empty snapshot list", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const forecast = await engine.aggregate([]);

    expect(typeof forecast.forecastAt).toBe("string");
    expect(forecast.stackUtilizationPercent).toBe(0);
    expect(forecast.totalDailyBurnUSD).toBe(0);
    expect(forecast.estimatedMonthlySpendUSD).toBe(0);
    expect(forecast.alerts).toHaveLength(0);
    expect(forecast.topSpenders).toHaveLength(0);
    expect(forecast.activeProviderCount).toBe(0);
  });

  test("computes stackUtilizationPercent as average of non-zero quotas", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const snapshots = [
      makeSnapshot("github",    { quotaUsedPercent: 40 }),
      makeSnapshot("openai",    { quotaUsedPercent: 60 }),
      makeSnapshot("anthropic", { quotaUsedPercent: 80 }),
      makeSnapshot("stripe",    { quotaUsedPercent: 0 }), // excluded from average
    ];
    const forecast = await engine.aggregate(snapshots);

    // Average of [40, 60, 80] = 60
    expect(forecast.stackUtilizationPercent).toBeCloseTo(60, 1);
    expect(forecast.activeProviderCount).toBe(4);
  });

  test("totalDailyBurnUSD sums all provider burns", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const snapshots = [
      makeSnapshot("openai",    { estimatedDailyBurnUSD: 5.25 }),
      makeSnapshot("anthropic", { estimatedDailyBurnUSD: 3.10 }),
      makeSnapshot("aws",       { estimatedDailyBurnUSD: 1.50 }),
    ];
    const forecast = await engine.aggregate(snapshots);

    expect(forecast.totalDailyBurnUSD).toBeCloseTo(9.85, 2);
    expect(forecast.estimatedMonthlySpendUSD).toBeCloseTo(9.85 * 30, 1);
  });

  test("estimatedMonthlySpendUSD = totalDailyBurnUSD * 30", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const snapshots = [makeSnapshot("stripe", { estimatedDailyBurnUSD: 2.0 })];
    const forecast = await engine.aggregate(snapshots);
    expect(forecast.estimatedMonthlySpendUSD).toBeCloseTo(60, 2);
  });

  test("alerts list contains providers at or above utilization threshold", async () => {
    const engine = new QuotaEngine({ cwd: dir, utilizationThresholdPct: 75 });
    const snapshots = [
      makeSnapshot("github",    { quotaUsedPercent: 50 }),  // ok
      makeSnapshot("openai",    { quotaUsedPercent: 80 }),  // alert
      makeSnapshot("anthropic", { quotaUsedPercent: 75 }),  // alert (exactly at threshold)
    ];
    const forecast = await engine.aggregate(snapshots);

    expect(forecast.alerts).toHaveLength(2);
    const alertProviders = forecast.alerts.map((a) => a.provider);
    expect(alertProviders).toContain("openai");
    expect(alertProviders).toContain("anthropic");
    expect(alertProviders).not.toContain("github");
  });

  test("alerts list contains providers exceeding budget", async () => {
    const engine = new QuotaEngine({ cwd: dir, budgetDailyUSD: 5 });
    const snapshots = [
      makeSnapshot("openai",    { estimatedDailyBurnUSD: 3 }), // ok
      makeSnapshot("anthropic", { estimatedDailyBurnUSD: 7 }), // alert
    ];
    const forecast = await engine.aggregate(snapshots);

    const burnAlerts = forecast.alerts.filter((a) => a.reason === "burn" || a.reason === "both");
    expect(burnAlerts.map((a) => a.provider)).toContain("anthropic");
  });

  test("topSpenders is sorted descending by estimatedDailyBurnUSD", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const snapshots = [
      makeSnapshot("aws",       { estimatedDailyBurnUSD: 1 }),
      makeSnapshot("openai",    { estimatedDailyBurnUSD: 10 }),
      makeSnapshot("anthropic", { estimatedDailyBurnUSD: 4 }),
    ];
    const forecast = await engine.aggregate(snapshots);

    expect(forecast.topSpenders[0]!.provider).toBe("openai");
    expect(forecast.topSpenders[1]!.provider).toBe("anthropic");
    expect(forecast.topSpenders[2]!.provider).toBe("aws");
  });

  test("topSpenders excludes providers with zero burn", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const snapshots = [
      makeSnapshot("github", { estimatedDailyBurnUSD: 0 }),
      makeSnapshot("openai", { estimatedDailyBurnUSD: 5 }),
    ];
    const forecast = await engine.aggregate(snapshots);

    expect(forecast.topSpenders.map((s) => s.provider)).not.toContain("github");
  });

  test("burnTrends length matches snapshot count", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const snapshots = [
      makeSnapshot("github"),
      makeSnapshot("openai"),
      makeSnapshot("stripe"),
    ];
    const forecast = await engine.aggregate(snapshots);
    expect(forecast.burnTrends).toHaveLength(3);
  });

  test("enriches snapshots with p50/p95 from histogram when available", async () => {
    // Pre-populate histogram with 5 latency samples for openai
    await writeHistogram("/unused-cwd", {
      openai: [20, 40, 60, 80, 200].map((latencyMs) => ({
        ts: Date.now(),
        latencyMs,
        status: "ok" as const,
      })),
    });

    const engine = new QuotaEngine({ cwd: dir });
    const snapshots = [makeSnapshot("openai", { latencyMs: 70 })];
    const forecast = await engine.aggregate(snapshots);

    const enriched = forecast.snapshots[0];
    expect(enriched!.p50Ms).toBeDefined();
    expect(typeof enriched!.p50Ms).toBe("number");
  });

  test("forecastAt is a valid ISO 8601 string", async () => {
    const engine = new QuotaEngine({ cwd: dir });
    const forecast = await engine.aggregate([makeSnapshot("github")]);
    expect(() => new Date(forecast.forecastAt)).not.toThrow();
    expect(new Date(forecast.forecastAt).toISOString()).toBe(forecast.forecastAt);
  });
});

// ---------------------------------------------------------------------------
// 7. buildForecast — end-to-end, skipped probes excluded
// ---------------------------------------------------------------------------

describe("buildForecast", () => {
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

  test("excludes skipped probes from the forecast", async () => {
    const results = [
      { provider: "github",    probedAt: new Date().toISOString(), latencyMs: 50, quotaUtilization: 0.3, status: "ok"      as const },
      { provider: "openai",    probedAt: new Date().toISOString(), latencyMs: 80, quotaUtilization: 0.6, status: "ok"      as const },
      { provider: "stripe",    probedAt: new Date().toISOString(), latencyMs:  0, status: "skipped" as const },
      { provider: "anthropic", probedAt: new Date().toISOString(), latencyMs:  0, status: "skipped" as const },
    ];

    const forecast = await buildForecast(results, { cwd: dir });

    expect(forecast.activeProviderCount).toBe(2);
    const providers = forecast.snapshots.map((s) => s.provider);
    expect(providers).toContain("github");
    expect(providers).toContain("openai");
    expect(providers).not.toContain("stripe");
    expect(providers).not.toContain("anthropic");
  });

  test("produces correct monthly spend from daily burns", async () => {
    const results = [
      {
        provider: "openai",
        probedAt: new Date().toISOString(),
        latencyMs: 100,
        quotaUtilization: 0.4,
        estimatedDailyBurnUSD: 8.0,
        status: "ok" as const,
      },
      {
        provider: "anthropic",
        probedAt: new Date().toISOString(),
        latencyMs: 90,
        quotaUtilization: 0.3,
        estimatedDailyBurnUSD: 4.0,
        status: "ok" as const,
      },
    ];

    const forecast = await buildForecast(results, { cwd: dir });

    expect(forecast.totalDailyBurnUSD).toBeCloseTo(12.0, 2);
    expect(forecast.estimatedMonthlySpendUSD).toBeCloseTo(360.0, 1);
  });

  test("respects budgetDailyUSD option", async () => {
    const results = [
      {
        provider: "openai",
        probedAt: new Date().toISOString(),
        latencyMs: 100,
        estimatedDailyBurnUSD: 25,
        status: "ok" as const,
      },
    ];

    const forecast = await buildForecast(results, { cwd: dir, budgetDailyUSD: 10 });

    expect(forecast.alerts.some((a) => a.provider === "openai")).toBe(true);
  });

  test("returns empty forecast when all probes are skipped", async () => {
    const results = [
      { provider: "github",    probedAt: new Date().toISOString(), latencyMs: 0, status: "skipped" as const },
      { provider: "openai",    probedAt: new Date().toISOString(), latencyMs: 0, status: "skipped" as const },
    ];

    const forecast = await buildForecast(results, { cwd: dir });

    expect(forecast.activeProviderCount).toBe(0);
    expect(forecast.totalDailyBurnUSD).toBe(0);
    expect(forecast.estimatedMonthlySpendUSD).toBe(0);
    expect(forecast.alerts).toHaveLength(0);
  });

  test("result has all required QuotaForecast fields", async () => {
    const results = [
      { provider: "github", probedAt: new Date().toISOString(), latencyMs: 55, status: "ok" as const },
    ];

    const forecast = await buildForecast(results, { cwd: dir });

    expect(typeof forecast.forecastAt).toBe("string");
    expect(typeof forecast.stackUtilizationPercent).toBe("number");
    expect(typeof forecast.totalDailyBurnUSD).toBe("number");
    expect(typeof forecast.estimatedMonthlySpendUSD).toBe("number");
    expect(Array.isArray(forecast.alerts)).toBe(true);
    expect(Array.isArray(forecast.topSpenders)).toBe(true);
    expect(Array.isArray(forecast.burnTrends)).toBe(true);
    expect(Array.isArray(forecast.snapshots)).toBe(true);
    expect(typeof forecast.activeProviderCount).toBe("number");
  });
});
