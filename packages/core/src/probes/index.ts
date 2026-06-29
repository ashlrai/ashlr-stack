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
 * Wires into `stack doctor --probes` and `stack probes generate-missing`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS_REF } from "../catalog.ts";
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
// Registry — all 11 built-in probes
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
// ProbeRegistry — declarative provider-name → Probe map
// ---------------------------------------------------------------------------

/**
 * ProbeRegistry maps provider names to their probe implementations.
 *
 * Supports:
 *  - `get(name)` — look up a probe by provider name.
 *  - `has(name)` — check whether a probe is registered.
 *  - `registeredNames()` — list all provider names with probes.
 *  - `missingProviders()` — providers in the catalog that lack a probe.
 *  - `coverageStats()` — { total, covered, pct, missing }.
 */
export class ProbeRegistry {
  private readonly map: Map<string, Probe>;

  constructor(probes: Probe[] = BUILTIN_PROBES) {
    this.map = new Map(probes.map((p) => [p.provider, p]));
  }

  /** Look up a registered probe by provider name. Returns undefined if not found. */
  get(providerName: string): Probe | undefined {
    return this.map.get(providerName);
  }

  /** Returns true when a probe is registered for the given provider name. */
  has(providerName: string): boolean {
    return this.map.has(providerName);
  }

  /** All provider names that have a registered probe. */
  registeredNames(): string[] {
    return Array.from(this.map.keys()).sort();
  }

  /**
   * All catalog provider names that do NOT have a registered probe.
   * These are the 32 providers (of 43 total) that need stub generation.
   */
  missingProviders(): string[] {
    const catalogNames = PROVIDERS_REF.map((p) => p.name);
    return catalogNames.filter((name) => !this.map.has(name)).sort();
  }

  /**
   * Coverage statistics against the full provider catalog.
   *
   * Returns:
   *   total   — total providers in the catalog
   *   covered — providers with a registered probe
   *   pct     — percentage covered (0–100, rounded)
   *   missing — provider names without probes
   */
  coverageStats(): { total: number; covered: number; pct: number; missing: string[] } {
    const total = PROVIDERS_REF.length;
    const missing = this.missingProviders();
    const covered = total - missing.length;
    const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
    return { total, covered, pct, missing };
  }
}

/** Singleton registry backed by the built-in probes. */
export const defaultProbeRegistry = new ProbeRegistry(BUILTIN_PROBES);

// ---------------------------------------------------------------------------
// Stub code generation
// ---------------------------------------------------------------------------

/**
 * Generate a skeleton TypeScript probe file for an unimplemented provider.
 *
 * The generated stub follows the same shape as the hand-written probes (e.g.
 * probe-github.ts) so a contributor only needs to fill in:
 *   1. The quota/health-check endpoint URL.
 *   2. The response-parsing logic.
 *
 * @param providerName  Matches a `ProviderRef.name` in the catalog (e.g. "turso").
 * @returns             The TypeScript source code as a string.
 */
export function generateProbeStub(providerName: string): string {
  const ref = PROVIDERS_REF.find((p) => p.name === providerName);
  const displayName = ref?.displayName ?? providerName;
  const secrets = ref?.secrets ?? [];
  const primarySecret = secrets[0] ?? `${providerName.toUpperCase()}_API_KEY`;
  const docsUrl = ref?.docs ?? `https://docs.${providerName}.com/api`;
  const dashboardUrl = ref?.dashboard ?? `https://${providerName}.com`;

  return `/**
 * ${displayName} health-check probe.
 *
 * TODO: Implement this stub.
 *   1. Replace QUOTA_ENDPOINT_URL with the actual health/quota endpoint.
 *   2. Parse the response body and populate the result fields.
 *
 * Reference docs: ${docsUrl}
 * Dashboard:      ${dashboardUrl}
 *
 * Credential(s) required: ${secrets.join(", ") || primarySecret}
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "${providerName}";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

// TODO: Replace with the actual quota or health-check endpoint URL.
// const QUOTA_ENDPOINT_URL = "https://api.${providerName}.com/TODO/quota";

const probe: Probe = {
  provider: PROVIDER,
  label: "${displayName} health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    // TODO: Swap out the credential name if the primary secret differs.
    const token = await tryRevealSecret("${primarySecret}");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "${primarySecret} not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      // TODO: Replace the URL and adjust headers / auth scheme as required.
      const res = await fetch("https://api.${providerName}.com/TODO/quota", {
        headers: {
          // TODO: Adjust the auth header for ${displayName}'s API.
          Authorization: \`Bearer \${token}\`,
          "User-Agent": "ashlr-stack-probe",
        },
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: \`${displayName} probe returned HTTP \${res.status}\`,
        };
      }

      // TODO: Parse the response body.
      // Example (adapt to the actual shape returned by ${displayName}):
      //
      //   const body = await res.json() as { used: number; limit: number };
      //   const utilization = body.limit > 0 ? body.used / body.limit : 0;
      //   const status = utilization >= ERROR_THRESHOLD ? "error"
      //                : utilization >= WARN_THRESHOLD  ? "warn"
      //                : "ok";
      //   return {
      //     provider: PROVIDER,
      //     probedAt: new Date().toISOString(),
      //     latencyMs,
      //     rateLimitCeiling: body.limit,
      //     quotaUtilization: utilization,
      //     status,
      //     alertThreshold: status !== "ok" ? \`quotaUtilization >= \${status === "error" ? ERROR_THRESHOLD : WARN_THRESHOLD}\` : undefined,
      //     detail: \`\${body.used}/\${body.limit} used\`,
      //   };

      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status: "ok",
        detail: "TODO: parse response and populate quota fields",
      };
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: \`${displayName} probe failed: \${(err as Error).message}\`,
      };
    }
  },
};

export default probe;
`;
}

// ---------------------------------------------------------------------------
// Stub file writer (used by the CLI command)
// ---------------------------------------------------------------------------

/**
 * Write a generated probe stub to disk.
 *
 * @param providerName  Provider to generate a stub for.
 * @param outputDir     Target directory (created if it does not exist).
 * @returns             Absolute path of the written file.
 */
export function writeProbeStub(providerName: string, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const fileName = `probe-${providerName}.ts`;
  const filePath = join(outputDir, fileName);
  writeFileSync(filePath, generateProbeStub(providerName), "utf-8");
  return filePath;
}

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
