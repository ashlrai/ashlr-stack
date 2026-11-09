import { describe, expect, test } from "bun:test";
import { JOB_RUN_SCHEMA } from "../fleet/job-run.ts";
import {
  collectSheetStatus,
  reconcileSheetExecution,
  toSheetAttempt,
} from "../fleet/sheet-status.ts";

const T0 = Date.parse("2026-11-07T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** Minimal fleet.job-run.v1 row; every field the reader checks is explicit. */
function record(
  executionId: string,
  finishedMs: number,
  options: {
    status?: "ok" | "error";
    job?: string;
    sheet?: string;
    writeStage?: { status?: string; rowsOut?: number } | null;
    extraStages?: { stage: string; status: string }[];
    lastError?: { stage: string; message: string } | null;
  } = {},
): Record<string, unknown> {
  const stages: Record<string, unknown>[] = options.extraStages?.slice() ?? [
    { stage: "read_postgres", status: "ok", durationMs: 10, rowsIn: 0, rowsOut: 100 },
    { stage: "transform", status: "ok", durationMs: 5, rowsIn: 100, rowsOut: 95 },
  ];
  if (options.writeStage !== null)
    stages.push({
      stage: "write_sheet_jobs",
      status: options.writeStage?.status ?? "ok",
      durationMs: 20,
      rowsIn: 95,
      rowsOut: options.writeStage?.rowsOut ?? 95,
    });
  return {
    schema: JOB_RUN_SCHEMA,
    job: options.job ?? "stacksync",
    executionId,
    direction: "postgres->sheets",
    startedAt: iso(finishedMs - 35),
    finishedAt: iso(finishedMs),
    durationMs: 35,
    status: options.status ?? "ok",
    rowsIn: 100,
    rowsOut: options.writeStage?.rowsOut ?? 95,
    stages,
    lastError: options.lastError === undefined ? null : options.lastError,
    persistError: null,
    ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
  };
}

describe("toSheetAttempt", () => {
  test("uses the sheet field as the key and falls back to job", () => {
    expect(toSheetAttempt(record("a1", T0, { sheet: "jobs" }))?.sheet).toBe("jobs");
    expect(toSheetAttempt(record("a2", T0))?.sheet).toBe("stacksync");
  });

  test("an ok record only counts when a write_sheet stage is ok", () => {
    expect(toSheetAttempt(record("a1", T0))?.wroteSheet).toBe(true);
    // The write stage errored but the record claims ok — inconsistent, not evidence.
    expect(toSheetAttempt(record("a2", T0, { writeStage: { status: "error" } }))?.wroteSheet).toBe(
      false,
    );
    // An ok run with no write stage at all is not sheet evidence either.
    expect(toSheetAttempt(record("a3", T0, { writeStage: null }))?.wroteSheet).toBe(false);
    // A failed run never counts, even if its write stage partially committed.
    expect(
      toSheetAttempt(
        record("a4", T0, { status: "error", writeStage: { status: "error", rowsOut: 40 } }),
      )?.wroteSheet,
    ).toBe(false);
  });

  test("drops malformed rows instead of trusting them", () => {
    for (const row of [
      { ...record("a1", T0), schema: "other" },
      { ...record("a1", T0), finishedAt: "not-a-date" },
      { ...record("a1", T0), status: "weird" },
      { ...record("a1", T0), executionId: "" },
      { ...record("a1", T0), stages: "not-array" },
      { ...record("a1", T0), sheet: "" },
      {},
    ])
      expect(toSheetAttempt(row)).toBeNull();
  });
});

describe("collectSheetStatus", () => {
  test("reports per-sheet state: ok, failing, never-ok and overdue sort worst-first", () => {
    const rows = [
      // jobs: succeeded an hour ago, then two failures — stale right now.
      record("ok1", T0 - 3_600_000),
      record("f1", T0 - 1_800_000, {
        status: "error",
        writeStage: { status: "error", rowsOut: 30 },
        lastError: { stage: "write_sheet_jobs", message: "Sheets API 429: quota exceeded" },
      }),
      record("f2", T0 - 600_000, {
        status: "error",
        writeStage: { status: "error" },
        lastError: { stage: "write_sheet_jobs", message: "timeout" },
      }),
      // metrics: healthy write five minutes ago.
      record("ok9", T0 - 300_000, { sheet: "metrics" }),
      // audit: attempted twice, never written.
      record("a1", T0 - 7200_000, { sheet: "audit", status: "error" }),
      record("a2", T0 - 120_000, { sheet: "audit", status: "error" }),
      // cron: ok but past the 30-minute expected cadence.
      record("ok2", T0 - 2_400_000, { sheet: "cron" }),
    ];
    const report = collectSheetStatus(rows, {
      now: T0,
      expectedIntervalMs: 1_800_000,
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.expectedIntervalMs).toBe(1_800_000);
    // Worst state first: failing, then never-ok, then overdue, then ok.
    expect(report.sheets.map((s) => s.sheet)).toEqual(["stacksync", "audit", "cron", "metrics"]);
    const jobs = report.sheets[0]!;
    expect(jobs).toMatchObject({
      sheet: "stacksync",
      state: "failing",
      attempts: 3,
      successes: 1,
      failuresSinceSuccess: 2,
      successAgeMs: 3_600_000,
    });
    expect(jobs.lastSuccess?.executionId).toBe("ok1");
    expect(jobs.lastAttempt).toMatchObject({ executionId: "f2", status: "error" });
    expect(jobs.lastError).toEqual({ stage: "write_sheet_jobs", message: "timeout" });
    expect(report.sheets[1]).toMatchObject({
      sheet: "audit",
      state: "never-ok",
      successes: 0,
      failuresSinceSuccess: 2,
      successAgeMs: null,
      lastSuccess: null,
    });
    expect(report.sheets[2]).toMatchObject({
      sheet: "cron",
      state: "overdue",
      successAgeMs: 2_400_000,
    });
    expect(report.sheets[3]).toMatchObject({ sheet: "metrics", state: "ok" });
  });

  test("a recovered sheet returns to ok and clears failuresSinceSuccess", () => {
    const rows = [
      record("ok1", T0 - 3_600_000),
      record("f1", T0 - 1_800_000, { status: "error" }),
      record("ok2", T0 - 60_000),
    ];
    const [jobs] = collectSheetStatus(rows, { now: T0 }).sheets;
    expect(jobs).toMatchObject({
      state: "ok",
      attempts: 3,
      successes: 2,
      failuresSinceSuccess: 0,
      successAgeMs: 60_000,
    });
  });

  test("ignores malformed and foreign-schema rows rather than trusting them", () => {
    const rows = [
      { junk: true },
      { schema: "other.v1", job: "stacksync", executionId: "x1" },
      record("ok1", T0 - 60_000),
    ];
    const report = collectSheetStatus(rows, { now: T0 });
    expect(report.sheets).toHaveLength(1);
    expect(report.sheets[0]?.attempts).toBe(1);
  });
});

describe("reconcileSheetExecution", () => {
  // The 5d2b848b question: the write died mid-batch — did a later run write the sheet?
  test("recovered when a later execution wrote the same sheet", () => {
    const rows = [
      record("5d2b848b", T0 - 3_600_000, {
        status: "error",
        writeStage: { status: "error", rowsOut: 340 },
        lastError: { stage: "write_sheet_jobs", message: "Sheets API 429: quota exceeded" },
      }),
      record("9a1c2d3e", T0 - 1_800_000, { sheet: undefined }),
      record("b7f4e5a6", T0 - 600_000),
    ];
    const report = reconcileSheetExecution(rows, "5d2b848b");
    expect(report).toMatchObject({
      executionId: "5d2b848b",
      sheet: "stacksync",
      verdict: "recovered",
      laterAttempts: 2,
      laterSuccesses: 2,
    });
    expect(report.target).toMatchObject({
      status: "error",
      writeRowsOut: 340, // the partial commit — where an idempotent retry resumes
      lastError: { stage: "write_sheet_jobs" },
    });
    // The FIRST later success is what ended the stale window.
    expect(report.firstLaterSuccess).toEqual({
      executionId: "9a1c2d3e",
      finishedAt: iso(T0 - 1_800_000),
    });
  });

  test("still-stale when later attempts exist but none wrote the sheet", () => {
    const rows = [
      record("5d2b848b", T0 - 3_600_000, { status: "error" }),
      record("9a1c2d3e", T0 - 1_800_000, { status: "error" }),
    ];
    const report = reconcileSheetExecution(rows, "5d2b848b");
    expect(report.verdict).toBe("still-stale");
    expect(report.laterAttempts).toBe(1);
    expect(report.laterSuccesses).toBe(0);
    expect(report.firstLaterSuccess).toBeNull();
  });

  test("still-stale with zero later attempts when nothing retried", () => {
    const report = reconcileSheetExecution(
      [record("5d2b848b", T0 - 3_600_000, { status: "error" })],
      "5d2b848b",
    );
    expect(report.verdict).toBe("still-stale");
    expect(report.laterAttempts).toBe(0);
  });

  test("a later write to a DIFFERENT sheet does not recover this one", () => {
    const rows = [
      record("5d2b848b", T0 - 3_600_000, { status: "error" }),
      record("9a1c2d3e", T0 - 1_800_000, { sheet: "metrics" }),
    ];
    const report = reconcileSheetExecution(rows, "5d2b848b");
    expect(report.verdict).toBe("still-stale");
    expect(report.laterAttempts).toBe(0);
  });

  test("not-found when no record carries the execution id", () => {
    const report = reconcileSheetExecution([record("a1", T0)], "5d2b848b");
    expect(report).toMatchObject({
      verdict: "not-found",
      sheet: null,
      target: null,
      laterAttempts: 0,
    });
  });

  test("out-of-order table rows still reconcile by finishedAt, not file order", () => {
    const rows = [
      record("9a1c2d3e", T0 - 1_800_000), // later success listed BEFORE the failure
      record("5d2b848b", T0 - 3_600_000, { status: "error" }),
    ];
    expect(reconcileSheetExecution(rows, "5d2b848b").verdict).toBe("recovered");
  });
});
