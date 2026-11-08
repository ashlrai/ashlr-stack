import { JOB_RUN_SCHEMA } from "./job-run.ts";

/**
 * sheet-status.ts — per-sheet sync status and post-failure reconciliation.
 *
 * Motivation: stacksync execution 5d2b848b died inside `write_sheet_jobs` and
 * operators could not answer the follow-up question — did a LATER sync
 * successfully write the jobs sheet, or is it still stale? `runJobStages`
 * already emits one record per execution; this module folds that JSONL table
 * into a per-sheet status surface (`collectSheetStatus`) and answers the
 * reconcile question for one execution (`reconcileSheetExecution`).
 *
 * A record "wrote the sheet" only when the run is ok AND a `write_sheet*`
 * stage reports ok — an ok record whose write stage was skipped or errored is
 * inconsistent and does not count. Rows are untrusted journal input: only the
 * fields below are read, and malformed rows are dropped by the caller's parse
 * layer (see `isJobRunRow`).
 */

/** Sheet-write stages are named `write_sheet_<sheet>`; the jobs sheet uses `write_sheet_jobs`. */
export const WRITE_SHEET_STAGE_PREFIX = "write_sheet";

export type SheetSyncState = "ok" | "overdue" | "failing" | "never-ok";

/** The validated subset of a job-run record that status reporting reads. */
export interface SheetAttempt {
  executionId: string;
  /** Sheet key: the record's `sheet` field when present, else `job`. */
  sheet: string;
  status: "ok" | "error";
  finishedAt: string;
  finishedMs: number;
  /** True only when the run is ok and a `write_sheet*` stage is ok. */
  wroteSheet: boolean;
  /** Partial commit count from the newest `write_sheet*` stage; null when absent. */
  writeRowsOut: number | null;
  lastError: { stage: string; message: string } | null;
}

const isRow = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/**
 * Narrow an untrusted journal row to a `SheetAttempt`; returns null when the
 * row is not a usable `fleet.job-run.v1` record. `sheet` overrides the key so
 * records from multi-sheet runs group correctly; otherwise the job name is
 * the sheet key, matching single-sheet stacksync runs.
 */
export function toSheetAttempt(row: Record<string, unknown>): SheetAttempt | null {
  if (row.schema !== JOB_RUN_SCHEMA) return null;
  if (!nonEmpty(row.job) || !nonEmpty(row.executionId)) return null;
  if (row.status !== "ok" && row.status !== "error") return null;
  if (row.sheet !== undefined && row.sheet !== null && !nonEmpty(row.sheet)) return null;
  const finishedMs = nonEmpty(row.finishedAt) ? Date.parse(row.finishedAt) : Number.NaN;
  if (!Number.isFinite(finishedMs)) return null;

  let wroteSheet = row.status === "ok";
  let sawWriteStage = false;
  let writeRowsOut: number | null = null;
  if (row.stages !== undefined && row.stages !== null) {
    if (!Array.isArray(row.stages)) return null;
    for (const stage of row.stages) {
      if (!isRow(stage) || !nonEmpty(stage.stage) || !nonEmpty(stage.status)) return null;
      if (!stage.stage.startsWith(WRITE_SHEET_STAGE_PREFIX)) continue;
      sawWriteStage = true;
      // Keep the last write stage's committed count: on a failed stage it is
      // the partial commit — the point an idempotent retry resumes from.
      writeRowsOut = count(stage.rowsOut);
      if (stage.status !== "ok") wroteSheet = false;
    }
  }
  // An ok run with no write stage is not evidence the sheet was written.
  if (row.status === "ok" && !sawWriteStage) wroteSheet = false;

  let lastError: SheetAttempt["lastError"] = null;
  if (isRow(row.lastError) && nonEmpty(row.lastError.stage) && nonEmpty(row.lastError.message))
    lastError = { stage: row.lastError.stage, message: row.lastError.message };

  return {
    executionId: row.executionId,
    sheet: nonEmpty(row.sheet) ? row.sheet : row.job,
    status: row.status,
    finishedAt: row.finishedAt as string,
    finishedMs,
    wroteSheet,
    writeRowsOut,
    lastError,
  };
}

export interface SheetLastEvent {
  executionId: string;
  finishedAt: string;
}

export interface SheetStatusRow {
  sheet: string;
  state: SheetSyncState;
  /** Executions recorded for this sheet. */
  attempts: number;
  /** Executions that wrote the sheet. */
  successes: number;
  /** Executions after the last successful write that did not write the sheet —
   * non-zero means the sheet has gone stale since its last good sync. */
  failuresSinceSuccess: number;
  /** Age of the last successful write relative to `now`; null when never ok. */
  successAgeMs: number | null;
  lastAttempt: (SheetLastEvent & { status: "ok" | "error" }) | null;
  lastSuccess: (SheetLastEvent & { rowsOut: number | null }) | null;
  /** Error from the newest failed execution; null when the last attempts are clean. */
  lastError: { stage: string; message: string } | null;
}

export interface SheetStatusReport {
  schemaVersion: 1;
  generatedAt: string;
  /** Cadence a sheet is expected to sync within; null when the caller did not set one. */
  expectedIntervalMs: number | null;
  sheets: SheetStatusRow[];
}

export interface SheetStatusOptions {
  now?: number;
  /** Expected sync cadence in ms; an ok sheet older than this is "overdue". */
  expectedIntervalMs?: number;
}

const STATE_RANK: Record<SheetSyncState, number> = {
  failing: 0,
  "never-ok": 1,
  overdue: 2,
  ok: 3,
};

/**
 * Fold job-run rows into one status row per sheet, worst state first. A sheet
 * is "failing" when executions after its last success all failed, "never-ok"
 * when no execution ever wrote it, "overdue" when it is past the expected
 * cadence, and "ok" otherwise.
 */
export function collectSheetStatus(
  rows: readonly Record<string, unknown>[],
  options: SheetStatusOptions = {},
): SheetStatusReport {
  const now = options.now ?? Date.now();
  const expected =
    options.expectedIntervalMs !== undefined &&
    Number.isFinite(options.expectedIntervalMs) &&
    options.expectedIntervalMs > 0
      ? options.expectedIntervalMs
      : null;

  const attempts = new Map<string, SheetAttempt[]>();
  for (const row of rows) {
    const attempt = toSheetAttempt(row);
    if (attempt === null) continue;
    const list = attempts.get(attempt.sheet) ?? [];
    list.push(attempt);
    attempts.set(attempt.sheet, list);
  }

  const sheets: SheetStatusRow[] = [...attempts].map(([sheet, list]) => {
    const ordered = [...list].sort((a, b) => a.finishedMs - b.finishedMs);
    const lastAttempt = ordered[ordered.length - 1]!;
    const successes = ordered.filter((a) => a.wroteSheet);
    const lastSuccess = successes[successes.length - 1] ?? null;
    const failuresSinceSuccess = ordered.filter(
      (a) => !a.wroteSheet && (lastSuccess === null || a.finishedMs > lastSuccess.finishedMs),
    ).length;
    const lastFailure = [...ordered].reverse().find((a) => a.status === "error") ?? null;
    const successAgeMs = lastSuccess === null ? null : Math.max(0, now - lastSuccess.finishedMs);
    const state: SheetSyncState =
      lastSuccess === null
        ? "never-ok"
        : failuresSinceSuccess > 0
          ? "failing"
          : expected !== null && successAgeMs !== null && successAgeMs > expected
            ? "overdue"
            : "ok";
    return {
      sheet,
      state,
      attempts: ordered.length,
      successes: successes.length,
      failuresSinceSuccess,
      successAgeMs,
      lastAttempt: {
        executionId: lastAttempt.executionId,
        finishedAt: lastAttempt.finishedAt,
        status: lastAttempt.status,
      },
      lastSuccess:
        lastSuccess === null
          ? null
          : {
              executionId: lastSuccess.executionId,
              finishedAt: lastSuccess.finishedAt,
              rowsOut: lastSuccess.writeRowsOut,
            },
      lastError: lastFailure?.lastError ?? null,
    };
  });

  sheets.sort(
    (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.sheet.localeCompare(b.sheet),
  );
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    expectedIntervalMs: expected,
    sheets,
  };
}

export type SheetReconcileVerdict = "recovered" | "still-stale" | "not-found";

export interface SheetReconcileReport {
  schemaVersion: 1;
  executionId: string;
  /** Sheet key inferred from the target record; null when it is not in the table. */
  sheet: string | null;
  verdict: SheetReconcileVerdict;
  /** The execution being reconciled; null when no record carries the id. */
  target: {
    executionId: string;
    finishedAt: string;
    status: "ok" | "error";
    /** Rows the failed write committed before dying — its resume point. */
    writeRowsOut: number | null;
    lastError: { stage: string; message: string } | null;
  } | null;
  /** Same-sheet executions finished at or after the target's finish. */
  laterAttempts: number;
  laterSuccesses: number;
  firstLaterSuccess: SheetLastEvent | null;
}

/**
 * The reconciliation question: for the sheet an execution was writing, did a
 * LATER run write it successfully, or is it still stale? "Later" means the
 * record finished at or after the target's finish under a different
 * executionId — table order is not trusted. "Recovered" reports the first
 * later successful write; "still-stale" splits into `laterAttempts === 0`
 * (nobody retried yet) and `> 0` (retries are failing).
 */
export function reconcileSheetExecution(
  rows: readonly Record<string, unknown>[],
  executionId: string,
): SheetReconcileReport {
  const attempts = rows
    .map(toSheetAttempt)
    .filter((a): a is SheetAttempt => a !== null)
    .sort((a, b) => a.finishedMs - b.finishedMs);
  const target = attempts.find((a) => a.executionId === executionId) ?? null;
  if (target === null)
    return {
      schemaVersion: 1,
      executionId,
      sheet: null,
      verdict: "not-found",
      target: null,
      laterAttempts: 0,
      laterSuccesses: 0,
      firstLaterSuccess: null,
    };

  const later = attempts.filter(
    (a) =>
      a.sheet === target.sheet &&
      a.executionId !== executionId &&
      a.finishedMs >= target.finishedMs,
  );
  const successes = later.filter((a) => a.wroteSheet);
  const first = successes[0] ?? null;
  return {
    schemaVersion: 1,
    executionId,
    sheet: target.sheet,
    verdict: first === null ? "still-stale" : "recovered",
    target: {
      executionId: target.executionId,
      finishedAt: target.finishedAt,
      status: target.status,
      writeRowsOut: target.writeRowsOut,
      lastError: target.lastError,
    },
    laterAttempts: later.length,
    laterSuccesses: successes.length,
    firstLaterSuccess:
      first === null ? null : { executionId: first.executionId, finishedAt: first.finishedAt },
  };
}
