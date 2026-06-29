/**
 * Provider Health Check Probe Suite — shared types.
 *
 * Probes extend reachability checks to measure quotas, rate-limits, and
 * billing burn-rate. Each probe is opt-in per provider and runs async after
 * `doctor` baseline checks.
 */

// ---------------------------------------------------------------------------
// Probe result
// ---------------------------------------------------------------------------

export interface ProbeResult {
  /** Provider name matching the Stack registry (e.g. "github", "openai"). */
  provider: string;
  /** Wall-clock time the probe ran. ISO 8601. */
  probedAt: string;
  /** Round-trip latency to the provider's quota/rate-limit endpoint (ms). */
  latencyMs: number;
  /** p50 latency over all historical samples (ms). Computed by histogram. */
  p50Ms?: number;
  /** p95 latency over all historical samples (ms). Computed by histogram. */
  p95Ms?: number;
  /** Fraction of quota consumed in [0, 1]. 1 = 100% used. */
  quotaUtilization?: number;
  /**
   * The provider-reported rate-limit ceiling — requests per window, or tokens
   * per minute, depending on what the API exposes. Units are provider-specific
   * and surfaced as-is.
   */
  rateLimitCeiling?: number;
  /**
   * Estimated daily spend in USD. Only populated for usage-based providers
   * that expose a cost or spend endpoint (OpenAI, Anthropic).
   */
  estimatedDailyBurnUSD?: number;
  /**
   * Human-readable detail — always present on "warn" and "error", optional on
   * "ok". May include quota numbers, threshold hints, etc.
   */
  detail?: string;
  /** Overall probe outcome. */
  status: "ok" | "warn" | "error" | "skipped";
  /**
   * If status === "warn" or "error", the threshold that was crossed.
   * e.g. "quotaUtilization > 0.80"
   */
  alertThreshold?: string;

  // ---------------------------------------------------------------------------
  // Permission fields (populated by the permission-validator engine)
  // ---------------------------------------------------------------------------

  /**
   * Permission validation status for this provider's credential.
   * Populated when `stack doctor --audit-permissions` or `stack audit-permissions`
   * runs alongside the probe suite.
   * "ok"              — scopes are least-privilege
   * "warn"            — missing a recommended scope
   * "overprivileged"  — broader access than needed
   * "error"           — forbidden scopes present
   * "skipped"         — no PermissionSet defined or credential absent
   */
  permissionStatus?: "ok" | "warn" | "overprivileged" | "error" | "skipped";

  /**
   * Human-readable summary of the permission check outcome.
   * Mirrors `PermissionValidationResult.detail`.
   */
  permissionDetail?: string;

  /**
   * Scopes/permissions detected from the live credential at probe time.
   * Empty when `permissionStatus` is "skipped".
   */
  grantedScopes?: string[];

  /**
   * Scope names that are overprivileged or forbidden.
   * Non-empty when `permissionStatus` is "overprivileged" or "error".
   */
  permissionViolations?: string[];
}

// ---------------------------------------------------------------------------
// Probe implementation contract
// ---------------------------------------------------------------------------

export interface ProbeContext {
  /** Abort signal forwarded from the CLI or pipeline. */
  signal?: AbortSignal;
  /** Structured logger. */
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

/**
 * A single provider probe. The `run` function must:
 * - Never throw — return `status: "error"` instead.
 * - Return `status: "skipped"` when the required credentials are absent and
 *   the probe is configured as opt-in.
 * - Be purely additive: it must not modify any provider state.
 */
export interface Probe {
  /** Provider name. Must match the Stack provider registry name. */
  provider: string;
  /** Short human label shown in `stack doctor --probes` output. */
  label: string;
  run(ctx: ProbeContext): Promise<ProbeResult>;
}

// ---------------------------------------------------------------------------
// Histogram types
// ---------------------------------------------------------------------------

/** A single persisted sample for one provider. */
export interface HistogramSample {
  ts: number; // epoch ms
  latencyMs: number;
  quotaUtilization?: number;
  estimatedDailyBurnUSD?: number;
  status: ProbeResult["status"];
}

/** Persisted histogram file shape: provider → samples (newest-last). */
export type HistogramStore = Record<string, HistogramSample[]>;

// ---------------------------------------------------------------------------
// Runner output
// ---------------------------------------------------------------------------

export interface ProbeRunSummary {
  ranAt: string; // ISO 8601
  results: ProbeResult[];
  /** Number of probes that returned status "warn" or "error". */
  alertCount: number;
}
