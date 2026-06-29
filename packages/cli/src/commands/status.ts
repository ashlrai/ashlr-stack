import {
  hasConfig,
  isPhantomInstalled,
  listSecrets,
  readConfig,
  buildRollbackGraph,
  buildRollbackPlan,
  RollbackGraphVisualizer,
} from "@ashlr/stack-core";
import type { OrchestrationEntry } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors } from "../ui.ts";

export const statusCommand = defineCommand({
  meta: { name: "status", description: "Show stack health at a glance." },
  args: {
    "rollback-plan": {
      type: "boolean",
      default: false,
      description:
        "Preview the rollback dependency graph — what would be torn down if the current provision fails.",
    },
    format: {
      type: "string",
      default: "ascii",
      description:
        "Output format for --rollback-plan: ascii | mermaid | json (default: ascii).",
    },
    "failure-point": {
      type: "string",
      description:
        "Simulate a failure at this provider name to see the partial rollback scope.",
    },
  },
  async run({ args }) {
    const showRollbackPlan = Boolean(args["rollback-plan"]);
    const format = (args.format ?? "ascii") as "ascii" | "mermaid" | "json";
    const failurePoint = args["failure-point"] as string | undefined;

    if (showRollbackPlan) {
      await runRollbackPlanPreview(format, failurePoint);
      return;
    }

    // --- default status output ---
    const hasStack = hasConfig();
    const phantomOk = await isPhantomInstalled();
    const config = hasStack ? await readConfig() : undefined;
    const vaultKeys = phantomOk ? await listSecrets().catch(() => []) : [];

    console.log();
    console.log(colors.bold("  Ashlr Stack"));
    console.log();
    console.log(
      `  ${statusDot(hasStack)} .stack.toml       ${hasStack ? colors.dim(config?.stack.project_id) : colors.dim("missing — run `stack init`")}`,
    );
    console.log(
      `  ${statusDot(phantomOk)} phantom           ${phantomOk ? colors.dim(`${vaultKeys.length} secrets in vault`) : colors.dim("not installed")}`,
    );
    console.log(
      `  ${statusDot(hasStack && Object.keys(config?.services ?? {}).length > 0)} services          ${colors.dim(`${Object.keys(config?.services ?? {}).length} configured`)}`,
    );
    console.log();
    if (config) {
      for (const [name, entry] of Object.entries(config.services)) {
        console.log(
          `    ${colors.cyan("·")} ${name.padEnd(14)} ${colors.dim(entry.resource_id ?? "-")}`,
        );
      }
      console.log();
    }
  },
});

function statusDot(ok: boolean): string {
  return ok ? colors.green("●") : colors.red("●");
}

/**
 * Build a rollback plan from current .stack.toml config and render it.
 */
async function runRollbackPlanPreview(
  format: "ascii" | "mermaid" | "json",
  failurePoint?: string,
): Promise<void> {
  const hasStack = hasConfig();
  if (!hasStack) {
    console.error(
      colors.red("  No .stack.toml found. Run `stack init` first."),
    );
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();
  const serviceNames = Object.keys(config.services);

  if (serviceNames.length === 0) {
    console.log(colors.dim("  No services configured — nothing to roll back."));
    return;
  }

  // Build orchestration entries from config services.
  // .stack.toml services don't carry explicit dependsOn at parse time, so
  // we build a flat entry list (no intra-service deps from config alone).
  // In a real orchestration run, deps come from the OrchestrationGroup.
  // This preview shows the structural graph derived from what's configured.
  const entries: OrchestrationEntry[] = serviceNames.map((name) => ({
    providerName: name,
    dependsOn: [],
  }));

  // Provision order is the order services appear in the config (stable).
  const provisionOrder = serviceNames;

  const graph = buildRollbackGraph(entries, failurePoint, provisionOrder);
  const plan = buildRollbackPlan(entries, provisionOrder, failurePoint);
  const viz = new RollbackGraphVisualizer(graph, plan);

  console.log();

  switch (format) {
    case "mermaid":
      console.log(viz.toMermaid());
      break;
    case "json": {
      const exported = viz.toJsonGraph();
      process.stdout.write(`${JSON.stringify(exported, null, 2)}\n`);
      break;
    }
    default:
      console.log(viz.toRollbackPlanPreview(failurePoint));
      console.log();
      console.log(colors.dim("  Tip: use --format mermaid or --format json for other output formats."));
      break;
  }

  console.log();
}
