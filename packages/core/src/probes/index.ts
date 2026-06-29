/**
 * Provider Health Check Probe Suite — runner + registry.
 *
 * Usage:
 *   import { runProbes } from "./probes/index.ts";
 *   const summary = await runProbes({ cwd: process.cwd(), providers: ["github", "openai"] });
 *
 * Each probe is opt-in: when credentials are absent the probe returns
 * `status: "skipped"` rather than failing. All probes run concurrently.
 * Results are persisted to `.stack/telemetry/health-probes.json`.
 *
 * Wires into `stack doctor --probes`.
 */

import { appendSample, computePercentiles, readHistogram } from "./histogram.ts";
import probeAnthropic from "./probe-anthropic.ts";
import probeAws from "./probe-aws.ts";
import probeClerk from "./probe-clerk.ts";
import probeFirebase from "./probe-firebase.ts";
import probeGithub from "./probe-github.ts";
import probeLinear from "./probe-linear.ts";
import probeNeon from "./probe-neon.ts";
import probeOpenai from "./probe-openai.ts";
import probeStripe from "./probe-stripe.ts";
import probeSupabase from "./probe-supabase.ts";
import probeVercel from "./probe-vercel.ts";
import type { Probe, ProbeContext, ProbeResult, ProbeRunSummary } from "./types.ts";

// ---------------------------------------------------------------------------
// Registry — all 10 built-in probes
// ---------------------------------------------------------------------------

export const BUILTIN_PROBES: Probe[] = [
  probeGithub,
  probeOpenai,
  probeAnthropic,
  probeStripe,
  probeVercel,
  probeSupabase,
  probeNeon,
  probeFirebase,
  probeClerk,
  probeLinear,
  probeAws,
];

// ---------------------------------------------------------------------------
// Runner options
// ---------------------------------------------------------------------------

export interface RunProbesOptions {
  /** Working directory — used to resolve `.stack/telemetry/health-probes.json`. */
  cwd: string;
  /**
   * Provider names to probe. If omitted, all registered probes are run.
   * Names must match `Probe.provider` (e.g. "github", "openai", "aws").
   */
  providers?: string[];
  /** AbortSignal forwarded to each probe's fetch calls. */
  signal?: AbortSignal;
  /** Optional logger; defaults to no-op. */
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /**
   * Extra probes to merge into the run. Useful for tests or custom providers
   * without registering them globally.
   */
  extraProbes?: Probe[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the requested probes concurrently, persist results to the 7-day rolling
 * histogram, and return a summary.
 */
export async function runProbes(opts: RunProbesOptions): Promise<ProbeRunSummary> {
  const log = opts.log ?? (() => {});
  const ctx: ProbeContext = { signal: opts.signal, log };

  // Select probes.
  const allProbes = [...BUILTIN_PROBES, ...(opts.extraProbes ?? [])];
  const selected = opts.providers
    ? allProbes.filter((p) => opts.providers!.includes(p.provider))
    : allProbes;

  // Run all probes concurrently.
  const rawResults = await Promise.all(
    selected.map(async (probe): Promise<ProbeResult> => {
      try {
        return await probe.run(ctx);
      } catch (err) {
        // Defense-in-depth: probes are supposed to never throw, but guard anyway.
        return {
          provider: probe.provider,
          probedAt: new Date().toISOString(),
          latencyMs: 0,
          status: "error",
          detail: `Probe threw unexpectedly: ${(err as Error).message}`,
        };
      }
    }),
  );

  // Persist samples and enrich with percentiles.
  const cwd = opts.cwd;
  const results: ProbeResult[] = [];

  for (const result of rawResults) {
    if (result.status !== "skipped") {
      await appendSample(cwd, result.provider, {
        ts: Date.now(),
        latencyMs: result.latencyMs,
        quotaUtilization: result.quotaUtilization,
        estimatedDailyBurnUSD: result.estimatedDailyBurnUSD,
        status: result.status,
      });
    }

    // Enrich with percentiles from the freshly updated histogram.
    const store = await readHistogram(cwd);
    const { p50Ms, p95Ms } = computePercentiles(store, result.provider);
    const enriched: ProbeResult = { ...result };
    if (p50Ms !== undefined) enriched.p50Ms = p50Ms;
    if (p95Ms !== undefined) enriched.p95Ms = p95Ms;
    results.push(enriched);
  }

  const alertCount = results.filter((r) => r.status === "warn" || r.status === "error").length;

  const summary: ProbeRunSummary = {
    ranAt: new Date().toISOString(),
    results,
    alertCount,
  };

  if (alertCount > 0) {
    log("warn", `${alertCount} probe(s) returned warn/error — run \`stack doctor --probes\` for details`);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { Probe, ProbeContext, ProbeResult, ProbeRunSummary } from "./types.ts";
export { appendSample, computePercentiles, readHistogram, writeHistogram } from "./histogram.ts";
export { __setHistogramDirForTesting } from "./histogram.ts";
