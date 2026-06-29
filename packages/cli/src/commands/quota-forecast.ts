/**
 * `stack quota-forecast` — Multi-Provider Quota Consensus & Spend Forecast
 *
 * Runs all 11 built-in probes in parallel, aggregates results via QuotaEngine,
 * and outputs either a human-readable report or machine-readable JSON.
 *
 * Usage:
 *   stack quota-forecast
 *   stack quota-forecast --json
 *   stack quota-forecast --budget 50
 *   stack quota-forecast --json --budget 100
 */

import { buildForecast, runProbes } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro } from "../ui.ts";

const BAR_WIDTH = 20;

function renderBar(pct: number): string {
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${pct.toFixed(1)}%`;
}

function statusColor(pct: number): (s: string) => string {
  if (pct >= 90) return colors.red;
  if (pct >= 75) return colors.yellow;
  return colors.green;
}

function fmtUSD(n: number): string {
  return `$${n.toFixed(4)}`;
}

export const quotaForecastCommand = defineCommand({
  meta: {
    name: "quota-forecast",
    description:
      "Run all provider probes in parallel and emit a stack-wide quota utilization and monthly spend forecast.",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON instead of the human-readable report.",
    },
    budget: {
      type: "string",
      description:
        "Daily budget cap in USD. Providers whose estimated daily burn exceeds this value are flagged.",
    },
  },

  async run({ args }) {
    const json = Boolean(args.json);
    const budgetDailyUSD = args.budget ? Number.parseFloat(args.budget) : undefined;

    if (!json) {
      intro("stack quota-forecast");
      console.log(
        `  ${colors.dim("Running all probes in parallel — credentials are read from Phantom vault")}\n`,
      );
    }

    // Run all 11 built-in probes concurrently.
    const summary = await runProbes({
      cwd: process.cwd(),
      log: json
        ? () => {}
        : (level, msg) => {
            if (level === "warn" || level === "error") {
              console.log(`  ${colors.yellow("⚠")} ${msg}`);
            }
          },
    });

    // Aggregate into a forecast.
    const forecast = await buildForecast(summary.results, {
      cwd: process.cwd(),
      budgetDailyUSD,
    });

    // -----------------------------------------------------------------------
    // JSON output
    // -----------------------------------------------------------------------
    if (json) {
      process.stdout.write(`${JSON.stringify(forecast, null, 2)}\n`);
      return;
    }

    // -----------------------------------------------------------------------
    // Human-readable report
    // -----------------------------------------------------------------------

    const { stackUtilizationPercent, totalDailyBurnUSD, estimatedMonthlySpendUSD, alerts, topSpenders, snapshots } = forecast;

    // Summary header
    console.log(`  ${colors.bold("Stack-wide utilization")}`);
    const barColor = statusColor(stackUtilizationPercent);
    console.log(`  ${barColor(renderBar(stackUtilizationPercent))}`);
    console.log();

    // Spend forecast
    console.log(`  ${colors.bold("Spend forecast")}`);
    console.log(`  Daily burn   : ${colors.cyan(fmtUSD(totalDailyBurnUSD))}`);
    console.log(`  Monthly (30d): ${colors.cyan(fmtUSD(estimatedMonthlySpendUSD))}`);
    if (budgetDailyUSD !== undefined) {
      const overBudget = totalDailyBurnUSD > budgetDailyUSD;
      const budgetLine = `  Daily budget : ${fmtUSD(budgetDailyUSD)}`;
      console.log(overBudget ? colors.red(budgetLine) : colors.green(budgetLine));
    }
    console.log();

    // Provider breakdown
    if (snapshots.length > 0) {
      console.log(`  ${colors.bold("Provider breakdown")} (${snapshots.length} active)`);
      for (const s of snapshots) {
        const pctColor = statusColor(s.quotaUsedPercent);
        const pctStr = pctColor(`${s.quotaUsedPercent.toFixed(1)}%`);
        const latency = `${s.latencyMs}ms`;
        const burn = s.estimatedDailyBurnUSD > 0
          ? ` · burn ${fmtUSD(s.estimatedDailyBurnUSD)}/day`
          : "";
        console.log(`    ${colors.bold(s.provider.padEnd(20))} ${pctStr.padEnd(12)} ${colors.dim(latency)}${colors.dim(burn)}`);
      }
      console.log();
    } else {
      console.log(
        `  ${colors.dim("No active providers — configure credentials in Phantom to enable probes.")}\n`,
      );
    }

    // Top spenders
    if (topSpenders.length > 0) {
      console.log(`  ${colors.bold("Top spenders")}`);
      for (const { provider, estimatedDailyBurnUSD: burn } of topSpenders.slice(0, 5)) {
        console.log(`    ${colors.bold(provider.padEnd(20))} ${colors.cyan(fmtUSD(burn))}/day`);
      }
      console.log();
    }

    // Alerts
    if (alerts.length > 0) {
      console.log(`  ${colors.bold(colors.yellow(`⚠  ${alerts.length} provider${alerts.length !== 1 ? "s" : ""} at risk`))}`);
      for (const alert of alerts) {
        const parts: string[] = [];
        if (alert.quotaUsedPercent !== undefined) {
          parts.push(`utilization ${alert.quotaUsedPercent.toFixed(1)}%`);
        }
        if (alert.estimatedDailyBurnUSD !== undefined && alert.budgetDailyUSD !== undefined) {
          parts.push(
            `daily burn ${fmtUSD(alert.estimatedDailyBurnUSD)} exceeds budget ${fmtUSD(alert.budgetDailyUSD)}`,
          );
        }
        console.log(`    ${colors.yellow("●")} ${colors.bold(alert.provider)}: ${parts.join(" · ")}`);
      }
      console.log();
      process.exitCode = 1;
    } else {
      console.log(`  ${colors.green("✓")} No providers at risk.\n`);
    }

    outro(
      `Probed ${forecast.activeProviderCount} provider${forecast.activeProviderCount !== 1 ? "s" : ""} · ${summary.alertCount} alert${summary.alertCount !== 1 ? "s" : ""}`,
    );
  },
});
