/**
 * Atomic Multi-Provider Rollback with Dependency Ordering
 *
 * Models provider deprovision dependencies as a directed acyclic graph (DAG)
 * and computes a safe teardown order that is the reverse of the provision order.
 *
 * Example dependency chain:
 *   stripe-webhook → stripe → supabase → clerk → user-data
 * Provision order:  user-data, clerk, supabase, stripe, stripe-webhook
 * Rollback order:   stripe-webhook, stripe, supabase, clerk, user-data
 *
 * The DAG is derived from the OrchestrationGroup's `dependsOn` declarations.
 * A provider that was provisioned after its dependencies must be deprovisioned
 * before them — exact reversal of the topological provision order.
 */

import { StackError } from "../errors.ts";
import type { OrchestrationEntry } from "../orchestration.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Maps each provider name to the list of providers that depend on it
 * (i.e., were provisioned after it and must be deprovisioned before it).
 *
 * In provision terms: if B dependsOn A, then A → [B] in this map.
 * In rollback terms: B must be torn down before A.
 */
export type RollbackGraph = Map<string, string[]>;

/**
 * A single wave of providers to deprovision concurrently.
 * All providers in a wave have no deprovision-ordering dependency between them.
 * Waves are executed in sequence; within a wave, deprovisions run in parallel.
 */
export interface RollbackWave {
  /** 0-based wave index within the plan. */
  index: number;
  /** Provider names to deprovision in this wave. */
  providers: string[];
}

/**
 * The full deprovision execution schedule, computed from the rollback DAG.
 * Waves are ordered so each wave's providers can be safely torn down after
 * all prior waves have completed.
 */
export interface RollbackPlan {
  /**
   * Ordered waves of deprovision operations.
   * Wave 0 runs first (these are the "leaf" dependents that nothing else
   * depends on — safe to remove immediately).
   */
  waves: RollbackWave[];
  /**
   * Flat ordered list of provider names for logging/transcript purposes.
   * Order matches the wave execution sequence.
   */
  orderedProviders: string[];
  /**
   * Set of provider names included in this plan (may be a subset of the
   * full orchestration group if a failurePoint was specified).
   */
  scope: Set<string>;
}

/**
 * Result of a single provider's deprovision attempt within a rollback plan.
 */
export interface RollbackStepResult {
  providerName: string;
  wave: number;
  status: "success" | "failure" | "skipped";
  /** Duration of the deprovision call in milliseconds. */
  durationMs: number;
  error?: string;
}

/**
 * Full recovery transcript emitted after executeRollbackPlan completes.
 * Carries enough context for operators to understand what happened and
 * what (if anything) requires manual intervention.
 */
export interface RollbackTranscript {
  /** Whether all providers in scope were successfully deprovisioned. */
  fullyRolledBack: boolean;
  /** Step-by-step results in deprovision execution order. */
  steps: RollbackStepResult[];
  /** Providers that failed to deprovision and require manual cleanup. */
  requiresManualCleanup: string[];
  /** Providers that were successfully torn down. */
  cleaned: string[];
  /** Providers that were skipped (e.g., no deprovision support). */
  skipped: string[];
  /**
   * Human-readable recovery guidance.
   * If fullyRolledBack is true, this is a confirmation message.
   * Otherwise it lists the resources that need manual attention.
   */
  recoverySuggestion: string;
  /**
   * The failure that triggered the rollback (the original error from step N).
   * Preserved here so callers can surface both the trigger and the recovery status.
   */
  triggerError?: string;
}

// ---------------------------------------------------------------------------
// Rollback graph construction
// ---------------------------------------------------------------------------

/**
 * Build a RollbackGraph from an orchestration group's entries.
 *
 * The graph maps provider → [dependents], where dependents are providers that
 * declared a `dependsOn` relationship to this provider. During rollback,
 * dependents must be torn down before their dependencies.
 *
 * @param entries      The orchestration entries describing the provision DAG.
 * @param failurePoint When specified, only include providers that were
 *                     successfully provisioned (i.e., providers at indices
 *                     0..N-1 in the provision topological order where N is
 *                     the index of the failing provider). This ensures we
 *                     only roll back what was actually provisioned.
 * @param provisionOrder The topological provision order computed by resolveOrder().
 *                       Required when failurePoint is specified.
 */
export function buildRollbackGraph(
  entries: OrchestrationEntry[],
  failurePoint?: string,
  provisionOrder?: string[],
): RollbackGraph {
  // Determine the scope of providers to include in the rollback plan.
  // If a failurePoint is specified, only include providers that were
  // provisioned before the failing step.
  let scope: Set<string>;
  if (failurePoint !== undefined && provisionOrder !== undefined) {
    const failIdx = provisionOrder.indexOf(failurePoint);
    if (failIdx === -1) {
      // failurePoint not in order — roll back everything that was provisioned
      scope = new Set(provisionOrder);
    } else {
      // Roll back providers at indices 0..failIdx-1 (those that succeeded)
      scope = new Set(provisionOrder.slice(0, failIdx));
    }
  } else {
    scope = new Set(entries.map((e) => e.providerName));
  }

  // Build the forward dependency map: for each dep, list its dependents.
  // Only include edges where both endpoints are in scope.
  const graph: RollbackGraph = new Map();

  // Pre-seed all in-scope providers with empty dependent lists.
  for (const name of scope) {
    graph.set(name, []);
  }

  for (const entry of entries) {
    if (!scope.has(entry.providerName)) continue;
    for (const dep of entry.dependsOn ?? []) {
      if (!scope.has(dep)) continue;
      // dep → entry.providerName: entry depends on dep, so entry must roll back first
      const dependents = graph.get(dep);
      if (dependents !== undefined) {
        dependents.push(entry.providerName);
      }
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Rollback plan computation (reverse topological sort)
// ---------------------------------------------------------------------------

/**
 * Compute a RollbackPlan from a RollbackGraph.
 *
 * Uses Kahn's algorithm on the reverse graph: providers with no remaining
 * dependents (in-degree 0 in deprovision order) can be torn down first.
 * This is the mirror image of how resolveOrder() computes provision order.
 *
 * The result is a wave-based schedule where each wave is safe to execute
 * concurrently (no intra-wave ordering constraint).
 */
export function computeRollbackPlan(graph: RollbackGraph): RollbackPlan {
  const scope = new Set(graph.keys());

  if (scope.size === 0) {
    return { waves: [], orderedProviders: [], scope };
  }

  // In rollback order, a provider can be torn down when all its dependents
  // have already been torn down. "dependents" here = providers that depend ON
  // this provider (and thus must be removed first).
  //
  // outDegree[p] = number of dependents of p still waiting to be processed.
  // When outDegree[p] drops to 0, p is ready to be deprovisioned.
  const outDegree = new Map<string, number>();
  // reverseEdges[p] = providers that p depends on (i.e., when p is done, decrement their outDegree)
  const reverseEdges = new Map<string, string[]>();

  for (const name of scope) {
    if (!outDegree.has(name)) outDegree.set(name, 0);
    if (!reverseEdges.has(name)) reverseEdges.set(name, []);
  }

  for (const [dep, dependents] of graph) {
    // dep → dependents: dep must be torn down AFTER all dependents
    // So dep's outDegree = number of dependents it has
    outDegree.set(dep, dependents.length);
    for (const dependent of dependents) {
      // When dependent is done, decrement dep's outDegree
      reverseEdges.get(dependent)!.push(dep);
    }
  }

  const waves: RollbackWave[] = [];
  const orderedProviders: string[] = [];
  const processed = new Set<string>();

  let waveIndex = 0;
  while (processed.size < scope.size) {
    // Collect all providers ready to deprovision (outDegree 0, not yet processed)
    const wave: string[] = [];
    for (const name of scope) {
      if (!processed.has(name) && outDegree.get(name) === 0) {
        wave.push(name);
      }
    }

    if (wave.length === 0) {
      // This should never happen in a valid (acyclic) graph after buildRollbackGraph
      // validates the DAG. If we hit it anyway, collect remaining and break.
      const remaining = [...scope].filter((n) => !processed.has(n));
      if (remaining.length > 0) {
        waves.push({ index: waveIndex, providers: remaining });
        orderedProviders.push(...remaining);
      }
      break;
    }

    // Sort wave for deterministic output (provider names are stable strings)
    wave.sort();
    waves.push({ index: waveIndex, providers: wave });
    orderedProviders.push(...wave);

    // Mark processed and update outDegrees for their dependencies
    for (const name of wave) {
      processed.add(name);
      // outDegree is already -Infinity-safe: set to -1 as sentinel
      outDegree.set(name, -1);
      for (const dep of reverseEdges.get(name) ?? []) {
        const current = outDegree.get(dep) ?? 0;
        if (current > 0) {
          outDegree.set(dep, current - 1);
        }
      }
    }

    waveIndex++;
  }

  return { waves, orderedProviders, scope };
}

// ---------------------------------------------------------------------------
// Rollback execution engine
// ---------------------------------------------------------------------------

/**
 * Callback type for provider deprovision. Called once per provider in the plan.
 * Should resolve if deprovision succeeded (or is a no-op), reject on failure.
 */
export type DeprovisionFn = (providerName: string, signal?: AbortSignal) => Promise<void>;

/**
 * Options for executeRollbackPlan.
 */
export interface ExecuteRollbackPlanOpts {
  /**
   * The deprovision function to call for each provider.
   * Receives the provider name and (optionally) an AbortSignal.
   */
  deprovision: DeprovisionFn;
  /**
   * Optional abort signal. If aborted, no new waves are started.
   * In-flight deprovisions are not cancelled (JS cooperative cancellation).
   */
  signal?: AbortSignal;
  /**
   * The original error that triggered the rollback. Included in the transcript.
   */
  triggerError?: string;
  /**
   * Providers that should be skipped during rollback (e.g. no deprovision support).
   * Their results will have status "skipped".
   */
  skipProviders?: Set<string>;
}

/**
 * Execute a RollbackPlan wave-by-wave, collecting results.
 *
 * Within each wave, deprovisions run in parallel (Promise.allSettled).
 * A failure in one wave does NOT abort subsequent waves — we attempt to
 * deprovision as much as possible even under partial failure, and report
 * everything that couldn't be cleaned up.
 *
 * Returns a detailed RollbackTranscript with per-step results and recovery guidance.
 */
export async function executeRollbackPlan(
  plan: RollbackPlan,
  opts: ExecuteRollbackPlanOpts,
): Promise<RollbackTranscript> {
  const steps: RollbackStepResult[] = [];
  const cleaned: string[] = [];
  const requiresManualCleanup: string[] = [];
  const skipped: string[] = [];
  const skipSet = opts.skipProviders ?? new Set<string>();

  for (const wave of plan.waves) {
    // Check for cancellation before starting a new wave
    if (opts.signal?.aborted) {
      // Mark remaining providers as skipped
      const remaining = plan.orderedProviders.filter(
        (n) => !cleaned.includes(n) && !requiresManualCleanup.includes(n) && !skipped.includes(n),
      );
      for (const name of remaining) {
        steps.push({
          providerName: name,
          wave: wave.index,
          status: "skipped",
          durationMs: 0,
          error: "Rollback aborted via signal",
        });
        skipped.push(name);
      }
      break;
    }

    // Run all providers in this wave in parallel
    const waveResults = await Promise.allSettled(
      wave.providers.map(async (name) => {
        if (skipSet.has(name)) {
          return { name, status: "skipped" as const, durationMs: 0 };
        }
        const t0 = Date.now();
        try {
          await opts.deprovision(name, opts.signal);
          return { name, status: "success" as const, durationMs: Date.now() - t0 };
        } catch (err) {
          return {
            name,
            status: "failure" as const,
            durationMs: Date.now() - t0,
            error: (err as Error).message,
          };
        }
      }),
    );

    for (let i = 0; i < wave.providers.length; i++) {
      const name = wave.providers[i];
      const settled = waveResults[i];

      if (settled.status === "rejected") {
        // Promise.allSettled should never reject since we catch inside, but be safe
        steps.push({ providerName: name, wave: wave.index, status: "failure", durationMs: 0, error: String(settled.reason) });
        requiresManualCleanup.push(name);
      } else {
        const r = settled.value;
        steps.push({
          providerName: r.name,
          wave: wave.index,
          status: r.status,
          durationMs: r.durationMs,
          ...(r.status === "failure" && "error" in r ? { error: r.error } : {}),
        });
        if (r.status === "success") cleaned.push(r.name);
        else if (r.status === "failure") requiresManualCleanup.push(r.name);
        else skipped.push(r.name);
      }
    }
  }

  const fullyRolledBack = requiresManualCleanup.length === 0 && skipped.length === 0;

  let recoverySuggestion: string;
  if (fullyRolledBack && cleaned.length > 0) {
    recoverySuggestion =
      `Rollback complete. All ${cleaned.length} provider(s) were successfully deprovisioned. ` +
      `Run \`stack doctor\` to verify final state.`;
  } else if (requiresManualCleanup.length > 0) {
    const list = requiresManualCleanup.join(", ");
    recoverySuggestion =
      `Partial rollback. The following provider(s) could NOT be automatically deprovisioned and ` +
      `require manual cleanup: ${list}. ` +
      `Delete their resources on the respective dashboards, then run \`stack doctor --fix\` to resync local state.`;
  } else if (skipped.length > 0 && cleaned.length === 0) {
    recoverySuggestion =
      `Rollback skipped all providers (no deprovision support or aborted). ` +
      `Manual cleanup may be required. Run \`stack doctor --fix\` after addressing any dangling resources.`;
  } else {
    recoverySuggestion = `Rollback complete with ${cleaned.length} cleaned, ${skipped.length} skipped. Run \`stack doctor\` to verify state.`;
  }

  return {
    fullyRolledBack,
    steps,
    requiresManualCleanup,
    cleaned,
    skipped,
    recoverySuggestion,
    ...(opts.triggerError !== undefined ? { triggerError: opts.triggerError } : {}),
  };
}

// ---------------------------------------------------------------------------
// Convenience: build plan directly from entries + provision order
// ---------------------------------------------------------------------------

/**
 * High-level helper: build the rollback graph and compute the plan in one call.
 *
 * @param entries        Orchestration entries (the provision DAG declaration).
 * @param provisionOrder Topological provision order (from resolveOrder()).
 * @param failurePoint   Provider name that failed; only providers provisioned
 *                       before this point are included in the rollback scope.
 */
export function buildRollbackPlan(
  entries: OrchestrationEntry[],
  provisionOrder: string[],
  failurePoint?: string,
): RollbackPlan {
  const graph = buildRollbackGraph(entries, failurePoint, provisionOrder);
  return computeRollbackPlan(graph);
}
