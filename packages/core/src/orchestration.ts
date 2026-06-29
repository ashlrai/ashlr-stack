import { type AddServiceOpts, type AddServiceResult, addService } from "./pipeline.ts";
import { StackError } from "./errors.ts";
import type { LogEvent } from "./providers/_base.ts";
import {
  buildRollbackGraph,
  buildRollbackPlan,
  computeRollbackPlan,
  executeRollbackPlan,
} from "./orchestration/rollback-graph.ts";

// Re-export rollback types and functions for consumers
export type {
  RollbackGraph,
  RollbackPlan,
  RollbackWave,
  RollbackStepResult,
  RollbackTranscript,
  DeprovisionFn,
  ExecuteRollbackPlanOpts,
} from "./orchestration/rollback-graph.ts";
export { buildRollbackGraph, buildRollbackPlan, computeRollbackPlan, executeRollbackPlan };

/**
 * One provider entry inside an orchestration group.
 *
 * `dependsOn` names other entries in the same group (by providerName).
 * Outputs from a dependency's AddServiceResult are available as
 * `resolvedOutputs[providerName]` in the `hints` of dependents via
 * the automatic output-threading mechanism.
 */
export interface OrchestrationEntry {
  providerName: string;
  /** Names of other providers in this group that must complete first. */
  dependsOn?: string[];
  /** Per-provider overrides merged on top of the group defaults. */
  opts?: Omit<AddServiceOpts, "providerName"> & {
    /**
     * Per-entry rollback callback. Called during orchestration-level rollback
     * for this specific provider. Overrides the group-level onRollback default.
     */
    onRollback?: OrchestrationRollbackFn;
  };
}

/**
 * Callback invoked during orchestration-level rollback for a provider that
 * was successfully provisioned but needs to be torn down due to a later
 * failure in the group. Receives the provider name and its AddServiceResult.
 *
 * Use this for cross-provider coordination work (e.g. unlinking Clerk from
 * Supabase before deprovisioning Clerk). The internal per-provider secrets /
 * MCP / upstream resource teardown is already handled by addService itself.
 */
export type OrchestrationRollbackFn = (
  providerName: string,
  result: AddServiceResult | undefined,
) => Promise<void>;

/** Defaults applied to every provider in the group unless overridden. */
export interface OrchestrationGroupDefaults {
  cwd?: string;
  interactive?: boolean;
  hints?: Record<string, unknown>;
  log?: (event: LogEvent) => void;
  timeoutMs?: number;
  persist?: boolean;
  /**
   * Default rollback callback. Called during orchestration-level rollback for
   * any provider in the group that doesn't declare its own onRollback.
   */
  onRollback?: OrchestrationRollbackFn;
}

export interface OrchestrationGroup {
  entries: OrchestrationEntry[];
  defaults?: OrchestrationGroupDefaults;
}

export interface OrchestrationResult {
  /** Results in topological (dependency) order. */
  results: AddServiceResult[];
  /** Map from providerName → AddServiceResult for easy lookup. */
  byProvider: Map<string, AddServiceResult>;
}

/**
 * Compute a topological ordering of the entries, detecting cycles.
 * Returns names in an order where each entry appears after all its dependencies.
 */
export function resolveOrder(entries: OrchestrationEntry[]): string[] {
  const names = new Set(entries.map((e) => e.providerName));

  // Validate all dependsOn refer to providers within the group.
  for (const entry of entries) {
    for (const dep of entry.dependsOn ?? []) {
      if (!names.has(dep)) {
        throw new StackError(
          "ORCHESTRATION_UNKNOWN_DEP",
          `ORCHESTRATION_UNKNOWN_DEP: Provider "${entry.providerName}" declares dependency on "${dep}" which is not in this orchestration group.`,
        );
      }
    }
  }

  // Kahn's algorithm for topological sort.
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // node → [dependents]

  // Pre-seed every known name so graph.get(dep) is never undefined.
  for (const entry of entries) {
    if (!inDegree.has(entry.providerName)) inDegree.set(entry.providerName, 0);
    if (!graph.has(entry.providerName)) graph.set(entry.providerName, []);
  }

  for (const entry of entries) {
    for (const dep of entry.dependsOn ?? []) {
      graph.get(dep)!.push(entry.providerName);
      inDegree.set(entry.providerName, (inDegree.get(entry.providerName) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const dependent of graph.get(node) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (order.length !== entries.length) {
    // Find the cycle members for a useful error message.
    const remaining = entries.map((e) => e.providerName).filter((n) => !order.includes(n));
    throw new StackError(
      "ORCHESTRATION_CYCLE",
      `ORCHESTRATION_CYCLE: Dependency cycle detected among providers: ${remaining.join(", ")}. ` +
        `Check the dependsOn declarations in your orchestration group.`,
    );
  }

  return order;
}

/**
 * Provision all providers in an orchestration group with:
 * - Dependency ordering (providers run after their declared dependencies)
 * - Parallel execution for providers with no ordering constraint between them
 * - Output threading: a completed provider's AddServiceResult is injected into
 *   the `hints.resolvedOutputs[providerName]` of every direct dependent
 * - DAG-based atomic rollback: when a provider fails, all previously-provisioned
 *   providers are deprovisioned in reverse topological order
 *
 * Single-provider provisioning (addService) is unchanged.
 */
export async function runOrchestrationGroup(
  group: OrchestrationGroup,
): Promise<OrchestrationResult> {
  if (group.entries.length === 0) {
    return { results: [], byProvider: new Map() };
  }

  const order = resolveOrder(group.entries);
  const entryMap = new Map(group.entries.map((e) => [e.providerName, e]));
  const byProvider = new Map<string, AddServiceResult>();
  const allResults: AddServiceResult[] = [];

  // Process in waves: each wave is the set of providers whose dependencies
  // have all completed. Within a wave, providers run in parallel.
  const remaining = new Set(order);

  while (remaining.size > 0) {
    // Collect providers whose deps are all done.
    const wave: string[] = [];
    for (const name of remaining) {
      const entry = entryMap.get(name)!;
      const depsAllDone = (entry.dependsOn ?? []).every((dep) => byProvider.has(dep));
      if (depsAllDone) wave.push(name);
    }

    // wave will always be non-empty in an acyclic graph (resolveOrder already ensures this).
    const waveSettled = await Promise.allSettled(
      wave.map((name) => {
        const entry = entryMap.get(name)!;
        const def = group.defaults ?? {};

        // Build resolvedOutputs for this provider's dependencies.
        const resolvedOutputs: Record<string, AddServiceResult> = {};
        for (const dep of entry.dependsOn ?? []) {
          resolvedOutputs[dep] = byProvider.get(dep)!;
        }

        // Merge hints: defaults < group-level < per-entry, with resolvedOutputs injected.
        const mergedHints: Record<string, unknown> = {
          ...(def.hints ?? {}),
          ...(entry.opts?.hints ?? {}),
          resolvedOutputs,
        };

        const opts: AddServiceOpts = {
          providerName: name,
          cwd: entry.opts?.cwd ?? def.cwd,
          interactive: entry.opts?.interactive ?? def.interactive,
          hints: mergedHints,
          log: entry.opts?.log ?? def.log,
          timeoutMs: entry.opts?.timeoutMs ?? def.timeoutMs,
          persist: entry.opts?.persist ?? def.persist,
          existingResourceId: entry.opts?.existingResourceId,
        };

        return addService(opts);
      }),
    );

    // Check for any failures in this wave.
    const failures: Array<{ name: string; error: Error }> = [];
    for (let i = 0; i < wave.length; i++) {
      const name = wave[i];
      const settled = waveSettled[i];
      if (settled.status === "fulfilled") {
        byProvider.set(name, settled.value);
        allResults.push(settled.value);
        remaining.delete(name);
      } else {
        failures.push({ name, error: settled.reason as Error });
      }
    }

    if (failures.length > 0) {
      // Partial-failure path: compute rollback order for all successfully-provisioned
      // providers (those in byProvider at this point) and execute in reverse topo order.
      const firstFailure = failures[0];
      const provisionedNames = [...byProvider.keys()];

      // Build the rollback plan scoped to providers that were actually provisioned.
      // We treat the failurePoint as the first failing provider — anything before it
      // in the provision order is in scope for rollback.
      const rollbackPlan = buildRollbackPlan(
        group.entries,
        order,
        firstFailure.name,
      );

      // Build a deprovision function that delegates to the per-entry removeService opt
      // or a no-op if none is provided (addService already handles its own deprovision
      // internally; here we handle cross-provider orchestration-level teardown).
      const deprovisionFn = async (providerName: string): Promise<void> => {
        const entry = entryMap.get(providerName);
        const def = group.defaults ?? {};
        const rollbackFn = entry?.opts?.onRollback ?? def.onRollback;
        if (rollbackFn) {
          const result = byProvider.get(providerName);
          await rollbackFn(providerName, result);
        }
        // Note: addService already rolled back its own internal state (secrets, MCP, upstream resource).
        // The orchestration-level onRollback is for cross-provider coordination
        // (e.g. unlinking Clerk from Supabase before deprovisioning Clerk).
      };

      const transcript = await executeRollbackPlan(rollbackPlan, {
        deprovision: deprovisionFn,
        triggerError: firstFailure.error.message,
      });

      // Build an enriched error message with the full recovery transcript.
      const failureList = failures.map((f) => `${f.name}: ${f.error.message}`).join("; ");
      const rollbackSummary = transcript.fullyRolledBack
        ? `Orchestration-level rollback complete (${transcript.cleaned.length} provider(s) rolled back).`
        : `Orchestration-level rollback PARTIAL — manual cleanup required for: ${transcript.requiresManualCleanup.join(", ")}.`;

      throw new StackError(
        "ORCHESTRATION_PARTIAL_FAILURE",
        `ORCHESTRATION_PARTIAL_FAILURE: ${failures.length} provider(s) failed in wave — ${failureList}. ` +
          `${rollbackSummary} ${transcript.recoverySuggestion}`,
      );
    }
  }

  // Return results in topological order.
  return {
    results: order.map((name) => byProvider.get(name)!),
    byProvider,
  };
}
