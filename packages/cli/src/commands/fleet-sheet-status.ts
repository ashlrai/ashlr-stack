import { homedir } from "node:os";
import { join } from "node:path";
import {
  type SheetReconcileReport,
  type SheetReconcileVerdict,
  type SheetStatusReport,
  collectSheetStatus,
  reconcileSheetExecution,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { type FleetSourceStatus, readFleetJsonl } from "../lib/fleet-jsonl.ts";

/**
 * `fleet-sheet-status` — operator surface for per-sheet sync staleness.
 *
 * Reads the stacksync job-run table (one `fleet.job-run.v1` record per
 * execution) and reports, per sheet, the last successful write, its age, and
 * how many executions have failed since — the "is the jobs sheet stale?"
 * glance. With `--execution <id>` it answers the reconciliation question for
 * one run: did a LATER execution write that sheet, or is it still stale?
 */

export const defaultRunsPath = (): string =>
  join(homedir(), ".ashlr-runs", "stacksync", "job-runs.jsonl");

export interface SheetStatusReportWithSource extends SheetStatusReport {
  /** Underlying table read result; anything but "ok" means the surface is degraded. */
  source: FleetSourceStatus;
}

export async function collectSheetStatusReport(
  runsPath: string,
  options: { expectedIntervalMs?: number; now?: number; sheet?: string } = {},
): Promise<SheetStatusReportWithSource> {
  const source = await readFleetJsonl(runsPath, {
    malformedLines: "flag",
    ioStatus: "unavailable",
  });
  const report = collectSheetStatus(source.rows, options);
  return {
    ...report,
    source: source.status,
    sheets:
      options.sheet === undefined
        ? report.sheets
        : report.sheets.filter((s) => s.sheet === options.sheet),
  };
}

export interface SheetReconcileReportWithSource extends Omit<SheetReconcileReport, "verdict"> {
  /** "unknown" when the table could not be read — a missing record is not evidence. */
  verdict: SheetReconcileVerdict | "unknown";
  source: FleetSourceStatus;
}

export async function collectSheetReconcile(
  runsPath: string,
  executionId: string,
): Promise<SheetReconcileReportWithSource> {
  const source = await readFleetJsonl(runsPath, {
    malformedLines: "flag",
    ioStatus: "unavailable",
  });
  // Only a table that yielded nothing at all is "unknown" — a missing file,
  // an unreadable file, or a table whose every line is corrupt. When flagged
  // lines left good rows behind (e.g. a crash-torn tail), reconcile on them
  // and surface the degraded `source` so operators know evidence is partial.
  if (source.status !== "ok" && source.rows.length === 0)
    return {
      schemaVersion: 1,
      executionId,
      sheet: null,
      verdict: "unknown",
      target: null,
      laterAttempts: 0,
      laterSuccesses: 0,
      firstLaterSuccess: null,
      source: source.status,
    };
  return { ...reconcileSheetExecution(source.rows, executionId), source: source.status };
}

const AGE_UNITS: [number, string][] = [
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
];
/** "3h" / "45m" / "12s" — compact enough for a one-line-per-sheet glance. */
export const ageLabel = (ms: number): string => {
  for (const [unit, label] of AGE_UNITS) if (ms >= unit) return `${Math.floor(ms / unit)}${label}`;
  return `${Math.floor(ms / 1000)}s`;
};

function printStatus(report: SheetStatusReportWithSource): void {
  if (report.source !== "ok") console.log(`job-run table: ${report.source}`);
  if (report.sheets.length === 0) {
    console.log("No sheet sync executions recorded.");
    return;
  }
  for (const s of report.sheets) {
    const success =
      s.lastSuccess === null
        ? "never written"
        : `last write ${ageLabel(s.successAgeMs ?? 0)} ago (${s.lastSuccess.executionId})`;
    const extra =
      s.state === "failing" || s.state === "never-ok"
        ? `, ${s.failuresSinceSuccess} attempt(s) since${s.lastError ? `; ${s.lastError.stage}: ${s.lastError.message}` : ""}`
        : "";
    console.log(`${s.sheet}: ${s.state} — ${success}${extra}`);
  }
}

function printReconcile(report: SheetReconcileReportWithSource): void {
  if (report.verdict === "unknown") {
    console.log(`${report.executionId}: unknown — job-run table ${report.source}`);
    return;
  }
  const degraded =
    report.source === "ok" ? "" : ` (job-run table: ${report.source} — evidence may be incomplete)`;
  if (report.verdict === "not-found") {
    console.log(`${report.executionId}: no record in the job-run table.${degraded}`);
    return;
  }
  const sheet = report.sheet ?? "unknown";
  if (report.verdict === "recovered" && report.firstLaterSuccess)
    console.log(
      `${report.executionId} (${sheet}): recovered — written by ${report.firstLaterSuccess.executionId} at ${report.firstLaterSuccess.finishedAt} (${report.laterAttempts} later attempt(s)).${degraded}`,
    );
  else
    console.log(
      `${report.executionId} (${sheet}): still-stale — no successful write in ${report.laterAttempts} later attempt(s).${degraded}`,
    );
}

const sheetStatusArgs = {
  runs: {
    type: "string",
    description: "Job-run JSONL table (default: ~/.ashlr-runs/stacksync/job-runs.jsonl).",
  },
  sheet: { type: "string", description: "Restrict the report to one sheet name." },
  execution: {
    type: "string",
    description:
      "Reconcile one execution id: did a later sync write its sheet, or is it still stale?",
  },
  expect: {
    type: "string",
    description:
      "Expected sync cadence in ms; an ok sheet whose last write is older is reported overdue.",
  },
  json: { type: "boolean", description: "Emit schemaVersion 1 JSON." },
} as const;

async function emitSheetStatus(args: {
  runs?: string | undefined;
  sheet?: string | undefined;
  execution?: string | undefined;
  expect?: string | undefined;
  json?: boolean | undefined;
}): Promise<void> {
  const runs = args.runs ?? defaultRunsPath();
  if (args.execution !== undefined) {
    if (args.execution.trim().length === 0) throw new Error("Execution id must be non-empty.");
    const report = await collectSheetReconcile(runs, args.execution);
    if (args.json) console.log(JSON.stringify(report));
    else printReconcile(report);
    return;
  }
  const expected = args.expect === undefined ? undefined : Number(args.expect);
  if (expected !== undefined && (!Number.isFinite(expected) || expected <= 0))
    throw new Error("Expected interval must be a positive number of milliseconds.");
  const report = await collectSheetStatusReport(runs, {
    expectedIntervalMs: expected,
    sheet: args.sheet,
  });
  if (args.json) console.log(JSON.stringify(report));
  else printStatus(report);
}

export const fleetSheetStatusCommand = defineCommand({
  meta: {
    name: "fleet-sheet-status",
    description:
      "Report per-sheet last successful sync and staleness, or reconcile one failed execution.",
  },
  args: sheetStatusArgs,
  async run({ args }) {
    await emitSheetStatus(args);
  },
});

/** Same report nested under `fleet` so `stack fleet sheet-status` resolves. */
export const fleetSheetStatusSubcommand = defineCommand({
  ...fleetSheetStatusCommand,
  meta: { ...fleetSheetStatusCommand.meta, name: "sheet-status" },
});
