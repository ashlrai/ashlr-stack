import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JOB_RUN_SCHEMA,
  type JobRunRecord,
  appendJobRunRecord,
  runJobStages,
} from "../fleet/job-run.ts";

const tmp = () => mkdtemp(join(tmpdir(), "fleet-job-run-"));

/** A clock that advances `step` ms per call — deterministic timings and stamps. */
const fakeClock = (start = 1_000, step = 25) => {
  let t = start;
  return () => {
    t += step;
    return t;
  };
};

describe("runJobStages", () => {
  test("failed write_sheet_jobs produces a queryable record with stage name and partial counts", async () => {
    // Mirrors production execution 5d2b848b: the sheet write died mid-batch and
    // the run left no structured trace of which stage failed or how far it got.
    const lines: string[] = [];
    const dir = await tmp();
    const tablePath = join(dir, "job-runs.jsonl");
    const record = await runJobStages({
      executionId: "5d2b848b",
      direction: "postgres->sheets",
      tablePath,
      logLine: (line) => lines.push(line),
      now: fakeClock(),
      stages: [
        {
          name: "read_postgres",
          run: (c) => {
            c.rowsOut = 1200;
          },
        },
        {
          name: "transform",
          run: (c) => {
            c.rowsIn = 1200;
            c.rowsOut = 1150;
          },
        },
        {
          name: "write_sheet_jobs",
          run: (c) => {
            c.rowsIn = 1150;
            c.rowsOut = 340; // partial commit before the API rejected the batch
            throw new Error("Sheets API 429: quota exceeded");
          },
        },
      ],
    });

    expect(record.schema).toBe(JOB_RUN_SCHEMA);
    expect(record.job).toBe("stacksync");
    expect(record.executionId).toBe("5d2b848b");
    expect(record.direction).toBe("postgres->sheets");
    expect(record.status).toBe("error");
    expect(record.lastError).toEqual({
      stage: "write_sheet_jobs",
      message: "Sheets API 429: quota exceeded",
    });
    // Every stage ran, each with a measured duration; the write kept its partial count.
    expect(record.stages).toEqual([
      { stage: "read_postgres", status: "ok", durationMs: 25, rowsIn: 0, rowsOut: 1200 },
      { stage: "transform", status: "ok", durationMs: 25, rowsIn: 1200, rowsOut: 1150 },
      { stage: "write_sheet_jobs", status: "error", durationMs: 25, rowsIn: 1150, rowsOut: 340 },
    ]);
    expect(record.rowsIn).toBe(1200);
    expect(record.rowsOut).toBe(340);
    expect(record.persistError).toBeNull();

    // The log line and the table row are the same queryable document.
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(record);
    const table = (await readFile(tablePath, "utf8")).trim().split("\n");
    expect(table).toHaveLength(1);
    expect(JSON.parse(table[0]!)).toEqual(record);
  });

  test("successful run reports ok status, generated id, and ISO bounds", async () => {
    const record = await runJobStages({
      logLine: false,
      stages: [
        {
          name: "read_postgres",
          run: (c) => {
            c.rowsOut = 7;
          },
        },
        {
          name: "transform",
          run: (c) => {
            c.rowsIn = 7;
            c.rowsOut = 7;
          },
        },
        {
          name: "write_sheet_jobs",
          run: (c) => {
            c.rowsIn = 7;
            c.rowsOut = 7;
          },
        },
      ],
    });
    expect(record.status).toBe("ok");
    expect(record.lastError).toBeNull();
    expect(record.executionId).toMatch(/^[0-9a-f]{8}$/);
    expect(record.rowsIn).toBe(7);
    expect(record.rowsOut).toBe(7);
    expect(record.stages.every((s) => s.status === "ok")).toBe(true);
    expect(Date.parse(record.startedAt)).toBeLessThanOrEqual(Date.parse(record.finishedAt));
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("early failure marks downstream stages skipped and still emits the record", async () => {
    const lines: string[] = [];
    const record = await runJobStages({
      logLine: (line) => lines.push(line),
      stages: [
        {
          name: "read_postgres",
          run: () => {
            throw new Error("connection refused");
          },
        },
        { name: "transform", run: () => {} },
        { name: "write_sheet_jobs", run: () => {} },
      ],
    });
    expect(record.status).toBe("error");
    expect(record.lastError?.stage).toBe("read_postgres");
    expect(record.stages[1]).toEqual({
      stage: "transform",
      status: "skipped",
      durationMs: null,
      rowsIn: 0,
      rowsOut: 0,
    });
    expect(record.stages[2]?.status).toBe("skipped");
    expect(record.rowsIn).toBe(0);
    expect(record.rowsOut).toBe(0);
    expect(lines).toHaveLength(1);
  });

  test("non-Error throws and oversized messages are flattened and capped", async () => {
    const record = await runJobStages({
      logLine: false,
      stages: [
        {
          name: "transform",
          run: () => {
            throw `line one\nline two   ${"x".repeat(1000)}`;
          },
        },
      ],
    });
    expect(record.status).toBe("error");
    expect(record.lastError?.stage).toBe("transform");
    expect(record.lastError?.message.includes("\n")).toBe(false);
    expect(record.lastError?.message.length).toBeLessThanOrEqual(503);
  });

  test("table append failure is recorded on the record, never thrown", async () => {
    const dir = await tmp();
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "not a directory");
    const record = await runJobStages({
      logLine: false,
      tablePath: join(blocker, "job-runs.jsonl"),
      stages: [{ name: "read_postgres", run: () => {} }],
    });
    expect(record.persistError).not.toBeNull();
  });
});

describe("appendJobRunRecord", () => {
  test("appends records as one JSONL row each, creating parent dirs", async () => {
    const dir = await tmp();
    const path = join(dir, "nested", "runs.jsonl");
    const record = await runJobStages({
      logLine: false,
      stages: [{ name: "read_postgres", run: () => {} }],
    });
    await appendJobRunRecord(path, record);
    await appendJobRunRecord(path, { ...record, status: "error" });
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const rows = lines.map((l) => JSON.parse(l) as JobRunRecord);
    expect(rows[0]?.status).toBe("ok");
    expect(rows[1]?.status).toBe("error");
  });
});
