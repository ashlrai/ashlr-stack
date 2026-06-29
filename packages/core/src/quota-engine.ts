/**
 * Multi-Provider Quota Consensus & Spend Forecast Engine
 *
 * Aggregates quota data across all providers to synthesize a stack-wide
 * utilization dashboard and monthly spend forecast.
 *
 * Key types / entry points:
 *   - `QuotaSnapshot`  — per-provider quota state at a point in time
 *   - `QuotaEngine`    — loads snapshots, computes trends, flags at-risk providers
 *   - `buildForecast`  — convenience: load + aggregate in one call
 */

import type { HistogramSample, HistogramStore } from "./probes/types.ts";
import { readHistogram } from "./probes/histogram.ts";

// ---------------------------------------------------------------------------
// QuotaSnapshot
// ---------------------------------------------------------------------------

/**
 * Normalized per-provider quota state collected by a probe run.
 * Maps 1-to-1 onto the fields emitted by each `ProbeResult`.
 */
export interface QuotaSnapshot {
  /** Provider name matching the Stack registry (e.g. "github", "openai"). */
  provider: string;
  /** Wall-clock time the snapshot was taken. ISO 8601. */
  snapshotAt: string;
  /** Round-trip latency to the provider's quota endpoint (ms). */
  latencyMs: number;
  /**
   * Quota consumed in [0, 100] — percentage form.
   * e.g. 75 means 75% of quota used.
   */
  quotaUsedPercent: number;
  /**
   * Provider-reported rate-limit ceiling (requests or tokens per window).
   * Units are provider-specific.
   */
  rateLimitRemaining: number;
  /**
   * Estimated daily spend in USD. 0 if the provider does not expose a cost
   * endpoint or if the probe did not return billing data.
   */
  estimatedDailyBurnUSD: number;
  /** p50 latency across the rolling 7-day histogram window (ms). */
  p50Ms?: number;
  /** p95 latency across the rolling 7-day histogram window (ms). */
  p95Ms?: number;
}

// ---------------------------------------------------------------------------
// Aggregated output types
// ---------------------------------------------------------------------------

/** Per-provider rolling 7-day trend summary. */
export interface BurnTrend {
  provider: string;
  /** Average daily burn over the available window (USD/day). */
  avgDailyBurnUSD: number;
  /** Number of histogram samples that contributed to the average. */
  sampleCount: number;
  /**
   * Simple linear trend slope (USD per day-step).
   * Positive = accelerating spend; negative = decelerating.
   */
  slopeDailyUSD: number;
}

/** A provider flagged because utilization or burn exceeds a threshold. */
export interface QuotaAlert {
  provider: string;
  reason: "utilization" | "burn" | "both";
  /** The triggering utilization value in [0, 100], if applicable. */
  quotaUsedPercent?: number;
  /** The triggering daily burn in USD, if applicable. */
  estimatedDailyBurnUSD?: number;
  /** Budget ceiling that was exceeded (USD/day), if a budget was supplied. */
  budgetDailyUSD?: number;
}

/** Full stack-wide forecast produced by `QuotaEngine.aggregate()`. */
export interface QuotaForecast {
  /** ISO 8601 timestamp of this forecast run. */
  forecastAt: string;
  /**
   * Stack-wide quota utilization percentage: average of all non-zero
   * `quotaUsedPercent` values across active providers.
   */
  stackUtilizationPercent: number;
  /** Sum of all providers' `estimatedDailyBurnUSD`. */
  totalDailyBurnUSD: number;
  /** `totalDailyBurnUSD * 30` — extrapolated calendar-month spend. */
  estimatedMonthlySpendUSD: number;
  /** Providers with utilization >= 75% or burn exceeding the daily budget. */
  alerts: QuotaAlert[];
  /** Top spenders ordered by `estimatedDailyBurnUSD` descending. */
  topSpenders: Array<{ provider: string; estimatedDailyBurnUSD: number }>;
  /** Rolling 7-day burn trends per provider. */
  burnTrends: BurnTrend[];
  /** The raw snapshots used to build this forecast. */
  snapshots: QuotaSnapshot[];
  /**
   * Number of providers that were probed (non-skipped). Excludes providers
   * for which no snapshot was supplied.
   */
  activeProviderCount: number;
}

// ---------------------------------------------------------------------------
// QuotaEngine options
// ---------------------------------------------------------------------------

export interface QuotaEngineOptions {
  /**
   * Working directory used to resolve the histogram store
   * (`<cwd>/.stack/telemetry/health-probes.json`).
   * Defaults to `process.cwd()`.
   */
  cwd?: string;
  /**
   * Optional daily budget cap in USD. Providers whose estimated daily burn
   * exceeds this value are flagged in `QuotaForecast.alerts`.
   */
  budgetDailyUSD?: number;
  /**
   * Utilization threshold (0–100) at which a provider is considered at-risk.
   * Defaults to 75.
   */
  utilizationThresholdPct?: number;
}

// ---------------------------------------------------------------------------
// QuotaEngine class
// ---------------------------------------------------------------------------

/**
 * Loads probe histogram data, enriches `QuotaSnapshot`s with p50/p95
 * latencies and rolling burn trends, and produces a `QuotaForecast`.
 *
 * Usage:
 *   const engine = new QuotaEngine({ cwd: process.cwd(), budgetDailyUSD: 50 });
 *   const forecast = await engine.aggregate(snapshots);
 */
export class QuotaEngine {
  private readonly cwd: string;
  private readonly budgetDailyUSD: number | undefined;
  private readonly utilizationThresholdPct: number;

  constructor(opts: QuotaEngineOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.budgetDailyUSD = opts.budgetDailyUSD;
    this.utilizationThresholdPct = opts.utilizationThresholdPct ?? 75;
  }

  // -------------------------------------------------------------------------
  // Histogram loading
  // -------------------------------------------------------------------------

  /**
   * Load the persisted histogram store from disk.
   * Returns an empty object if the file is absent or corrupt.
   */
  async loadHistogram(): Promise<HistogramStore> {
    return readHistogram(this.cwd);
  }

  // -------------------------------------------------------------------------
  // Percentile helpers
  // -------------------------------------------------------------------------

  /**
   * Compute a percentile (0–100) from an array of numeric values.
   * Returns `undefined` when the array is empty.
   */
  computePercentile(values: number[], pct: number): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * Compute p50 and p95 latency for `provider` using the histogram store.
   */
  computeLatencyPercentiles(
    store: HistogramStore,
    provider: string,
  ): { p50Ms: number | undefined; p95Ms: number | undefined } {
    const samples = store[provider];
    if (!samples || samples.length === 0) return { p50Ms: undefined, p95Ms: undefined };
    const latencies = samples.map((s) => s.latencyMs);
    return {
      p50Ms: this.computePercentile(latencies, 50),
      p95Ms: this.computePercentile(latencies, 95),
    };
  }

  // -------------------------------------------------------------------------
  // Rolling burn trend
  // -------------------------------------------------------------------------

  /**
   * Compute a rolling 7-day burn trend for `provider` from historical samples.
   *
   * Only samples with `estimatedDailyBurnUSD > 0` are considered. The slope
   * is calculated via a simple linear regression over (sample-index, burnUSD)
   * pairs — good enough for anomaly detection without external dependencies.
   */
  computeBurnTrend(store: HistogramStore, provider: string): BurnTrend {
    const samples = (store[provider] ?? []).filter(
      (s): s is HistogramSample & { estimatedDailyBurnUSD: number } =>
        typeof s.estimatedDailyBurnUSD === "number" && s.estimatedDailyBurnUSD > 0,
    );

    if (samples.length === 0) {
      return { provider, avgDailyBurnUSD: 0, sampleCount: 0, slopeDailyUSD: 0 };
    }

    const burns = samples.map((s) => s.estimatedDailyBurnUSD);
    const avg = burns.reduce((a, b) => a + b, 0) / burns.length;

    // Simple OLS slope: sum((i - x̄)(y_i - ȳ)) / sum((i - x̄)^2)
    const n = burns.length;
    const xBar = (n - 1) / 2; // index mean for 0-based indices
    const yBar = avg;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xBar) * (burns[i]! - yBar);
      denominator += (i - xBar) ** 2;
    }
    const slope = denominator === 0 ? 0 : numerator / denominator;

    return {
      provider,
      avgDailyBurnUSD: avg,
      sampleCount: n,
      slopeDailyUSD: slope,
    };
  }

  // -------------------------------------------------------------------------
  // Alert detection
  // -------------------------------------------------------------------------

  /**
   * Inspect a `QuotaSnapshot` and emit a `QuotaAlert` when:
   *   - `quotaUsedPercent` >= `utilizationThresholdPct`, OR
   *   - `estimatedDailyBurnUSD` > `budgetDailyUSD` (if a budget was set).
   *
   * Returns `undefined` if no threshold is crossed.
   */
  detectAlert(snapshot: QuotaSnapshot): QuotaAlert | undefined {
    const utilizationHit = snapshot.quotaUsedPercent >= this.utilizationThresholdPct;
    const burnHit =
      this.budgetDailyUSD !== undefined &&
      snapshot.estimatedDailyBurnUSD > this.budgetDailyUSD;

    if (!utilizationHit && !burnHit) return undefined;

    const reason: QuotaAlert["reason"] =
      utilizationHit && burnHit ? "both" : utilizationHit ? "utilization" : "burn";

    const alert: QuotaAlert = {
      provider: snapshot.provider,
      reason,
    };
    if (utilizationHit) alert.quotaUsedPercent = snapshot.quotaUsedPercent;
    if (burnHit) {
      alert.estimatedDailyBurnUSD = snapshot.estimatedDailyBurnUSD;
      alert.budgetDailyUSD = this.budgetDailyUSD;
    }
    return alert;
  }

  // -------------------------------------------------------------------------
  // Main aggregation
  // -------------------------------------------------------------------------

  /**
   * Aggregate a list of `QuotaSnapshot`s into a full `QuotaForecast`.
   *
   * The method:
   *   1. Loads the histogram store from disk.
   *   2. Enriches each snapshot with p50/p95 from the historical store.
   *   3. Computes rolling 7-day burn trends per provider.
   *   4. Flags providers that exceed utilization or burn thresholds.
   *   5. Assembles and returns the `QuotaForecast`.
   */
  async aggregate(snapshots: QuotaSnapshot[]): Promise<QuotaForecast> {
    const store = await this.loadHistogram();

    // Enrich snapshots with histogram percentiles.
    const enriched: QuotaSnapshot[] = snapshots.map((s) => {
      const { p50Ms, p95Ms } = this.computeLatencyPercentiles(store, s.provider);
      return {
        ...s,
        ...(p50Ms !== undefined ? { p50Ms } : {}),
        ...(p95Ms !== undefined ? { p95Ms } : {}),
      };
    });

    // Stack-wide utilization: average of providers with non-zero quota data.
    const utilizationSnapshots = enriched.filter((s) => s.quotaUsedPercent > 0);
    const stackUtilizationPercent =
      utilizationSnapshots.length === 0
        ? 0
        : utilizationSnapshots.reduce((sum, s) => sum + s.quotaUsedPercent, 0) /
          utilizationSnapshots.length;

    // Total daily burn.
    const totalDailyBurnUSD = enriched.reduce((sum, s) => sum + s.estimatedDailyBurnUSD, 0);

    // Alerts.
    const alerts: QuotaAlert[] = enriched
      .map((s) => this.detectAlert(s))
      .filter((a): a is QuotaAlert => a !== undefined);

    // Top spenders (descending by daily burn).
    const topSpenders = [...enriched]
      .filter((s) => s.estimatedDailyBurnUSD > 0)
      .sort((a, b) => b.estimatedDailyBurnUSD - a.estimatedDailyBurnUSD)
      .map(({ provider, estimatedDailyBurnUSD }) => ({ provider, estimatedDailyBurnUSD }));

    // Burn trends — computed from histogram for every provider in the snapshot set.
    const burnTrends: BurnTrend[] = enriched.map((s) =>
      this.computeBurnTrend(store, s.provider),
    );

    return {
      forecastAt: new Date().toISOString(),
      stackUtilizationPercent: Math.round(stackUtilizationPercent * 100) / 100,
      totalDailyBurnUSD: Math.round(totalDailyBurnUSD * 10000) / 10000,
      estimatedMonthlySpendUSD: Math.round(totalDailyBurnUSD * 30 * 10000) / 10000,
      alerts,
      topSpenders,
      burnTrends,
      snapshots: enriched,
      activeProviderCount: enriched.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Convert a `ProbeResult` to a `QuotaSnapshot`.
 * Fields that are undefined in `ProbeResult` fall back to safe defaults.
 */
export function probeResultToSnapshot(result: {
  provider: string;
  probedAt: string;
  latencyMs: number;
  quotaUtilization?: number;
  rateLimitRemaining?: number;
  estimatedDailyBurnUSD?: number;
  p50Ms?: number;
  p95Ms?: number;
}): QuotaSnapshot {
  return {
    provider: result.provider,
    snapshotAt: result.probedAt,
    latencyMs: result.latencyMs,
    quotaUsedPercent: (result.quotaUtilization ?? 0) * 100,
    rateLimitRemaining: result.rateLimitRemaining ?? 0,
    estimatedDailyBurnUSD: result.estimatedDailyBurnUSD ?? 0,
    ...(result.p50Ms !== undefined ? { p50Ms: result.p50Ms } : {}),
    ...(result.p95Ms !== undefined ? { p95Ms: result.p95Ms } : {}),
  };
}

/**
 * Build a `QuotaForecast` directly from probe results.
 * Convenience wrapper around `QuotaEngine.aggregate()`.
 */
export async function buildForecast(
  probeResults: Array<{
    provider: string;
    probedAt: string;
    latencyMs: number;
    quotaUtilization?: number;
    rateLimitRemaining?: number;
    estimatedDailyBurnUSD?: number;
    p50Ms?: number;
    p95Ms?: number;
    status: string;
  }>,
  opts: QuotaEngineOptions = {},
): Promise<QuotaForecast> {
  // Exclude skipped probes — they carry no real data.
  const active = probeResults.filter((r) => r.status !== "skipped");
  const snapshots = active.map(probeResultToSnapshot);
  const engine = new QuotaEngine(opts);
  return engine.aggregate(snapshots);
}
