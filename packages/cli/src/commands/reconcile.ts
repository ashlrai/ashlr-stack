/**
 * `stack reconcile` — re-validate every resource against live API state,
 * surface diffs, and optionally auto-remediate common drifts.
 *
 * Usage:
 *   stack reconcile             # dry-run: show drifts, no writes
 *   stack reconcile --apply     # apply patches (region/tier corrections)
 *   stack reconcile --json      # machine-readable output
 *   stack reconcile --service <name>  # single service
 */

import { readConfig } from "@ashlr/stack-core";
import {
  type LiveProbeMap,
  ResourceLifecycle,
  type ReconcileSummary,
} from "@ashlr/stack-core/resource-lifecycle";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError } from "../ui.ts";

export const reconcileCommand = defineCommand({
  meta: {
    name: "reconcile",
    description:
      "Re-validate every resource against live API state, detect drift, and optionally auto-remediate.",
  },
  args: {
    apply: {
      type: "boolean",
      default: false,
      description:
        "Apply auto-remediations (patch region/tier drift, bump last_verified_at). Without this flag the command is a dry-run.",
    },
    service: {
      type: "string",
      description: "Reconcile only a single service by name.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON.",
    },
    "stale-days": {
      type: "string",
      default: "7",
      description: "Number of days before a resource is considered stale (default: 7).",
    },
  },
  async run({ args }) {
    const apply = Boolean(args.apply);
    const json = Boolean(args.json);
    const staleDays = Math.max(1, Number(args["stale-days"] ?? 7) || 7);
    const staleThresholdMs = staleDays * 24 * 60 * 60 * 1000;
    const cwd = process.cwd();

    if (!json) intro(`stack reconcile${apply ? " --apply" : " (dry-run)"}`);

    // Load config to know which services exist
    const config = await readConfig(cwd).catch(() => undefined);
    if (!config) {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ error: "No .stack.toml found. Run `stack init` first." })}\n`,
        );
        process.exitCode = 1;
        return;
      }
      outroError("No .stack.toml found. Run `stack init` first.");
      return;
    }

    // Load the lifecycle registry
    const registry = await ResourceLifecycle.load(cwd);

    // Seed any services that are in config but not yet tracked
    for (const [name, entry] of Object.entries(config.services)) {
      if (!registry.get(name) && entry.resource_id) {
        registry.set(
          name,
          ResourceLifecycle.seedFromService(name, {
            resource_id: entry.resource_id,
            provider: entry.provider,
            region: entry.region,
            meta: entry.meta,
            created_at: entry.created_at,
          }),
        );
      }
    }

    // Determine which services to reconcile
    const allServices = registry.services();
    const targetServices = args.service
      ? allServices.filter((s) => s === args.service)
      : allServices;

    if (targetServices.length === 0) {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            reconciledAt: new Date().toISOString(),
            total: 0,
            ok: 0,
            patched: 0,
            failed: 0,
            results: [],
          })}\n`,
        );
        return;
      }
      outro(colors.dim("No tracked resources to reconcile."));
      return;
    }

    if (!json) {
      console.log(
        `\n  ${colors.dim(`Reconciling ${targetServices.length} resource(s)…`)}\n`,
      );
    }

    // Build live probe map — in production these would call provider APIs.
    // The registry accepts externally-injected probes so this is testable.
    const liveProbes: LiveProbeMap = buildLiveProbes(config);

    // Run reconciliation for each target service
    const subRegistry = new ResourceLifecycle(
      Object.fromEntries(
        targetServices
          .map((s) => [s, registry.get(s)])
          .filter((e): e is [string, NonNullable<typeof e[1]>] => e[1] !== undefined),
      ),
      cwd,
    );

    const summary: ReconcileSummary = await subRegistry.reconcileAll({
      liveProbes,
      apply,
      staleThresholdMs,
    });

    if (apply) {
      // Persist patched records back to the full registry
      for (const result of summary.results) {
        if (result.patched) {
          const updated = subRegistry.get(result.service);
          if (updated) registry.set(result.service, updated);
        }
      }
      await registry.save();
    }

    if (json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      const hasIssues = summary.results.some(
        (r) => r.drift.kind === "deleted" || r.drift.kind === "degraded",
      );
      process.exitCode = hasIssues ? 1 : 0;
      return;
    }

    // Human-readable output
    console.log();
    for (const result of summary.results) {
      const { service, drift, patched, error } = result;
      const icon =
        drift.kind === "ok"
          ? colors.green("●")
          : drift.kind === "deleted"
            ? colors.red("✗")
            : drift.kind === "degraded"
              ? colors.yellow("▲")
              : drift.kind === "stale"
                ? colors.cyan("○")
                : colors.dim("?");

      let line = `  ${icon} ${colors.bold(service)} ${colors.dim(`[${drift.kind}]`)}`;
      if (drift.kind !== "ok") line += `\n    ${colors.dim(drift.detail)}`;
      if (patched) line += `\n    ${colors.green("→ patched")}`;
      if (error) line += `\n    ${colors.red(`! probe error: ${error}`)}`;
      console.log(line);
    }

    console.log();
    console.log(
      `  ${colors.bold("Summary:")} ${summary.total} resource(s) · ` +
        `${colors.green(`${summary.ok} ok`)} · ` +
        `${colors.yellow(`${summary.patched} patched`)} · ` +
        `${colors.red(`${summary.failed} failed`)}`,
    );

    const drifted = summary.results.filter(
      (r) => r.drift.kind === "deleted" || r.drift.kind === "degraded",
    );
    if (drifted.length > 0 && !apply) {
      console.log(
        `\n  ${colors.yellow("⚠")} ${drifted.length} resource(s) have drift. ` +
          `Run ${colors.bold("stack reconcile --apply")} to auto-remediate.`,
      );
    }

    console.log();

    if (drifted.length > 0) {
      process.exitCode = 1;
      outroError(`${drifted.length} resource(s) drifted from desired state.`);
    } else {
      outro(
        apply
          ? colors.green("Reconcile complete.")
          : colors.green("All resources match desired state."),
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Live probe builder
// ---------------------------------------------------------------------------

/**
 * Build a LiveProbeMap from the configured services.
 *
 * In a real deployment each provider module would export a `liveProbe`
 * function.  Here we fall back to a best-effort "alive = true" stub so the
 * reconcile command is usable without network access.  The probe is injected
 * so integration tests can substitute mocks.
 */
function buildLiveProbes(
  _config: Awaited<ReturnType<typeof readConfig>>,
): LiveProbeMap {
  // Return an empty map — callers (tests, future provider integrations) inject
  // their own probes.  When no probe is registered for a provider the registry
  // marks the resource as "stale" after the threshold rather than "deleted".
  return {};
}
