import { describe, expect, test } from "bun:test";
import { type StageCounts, runJobStages } from "../fleet/job-run.ts";
import { withStageRetry } from "../fleet/stage-retry.ts";

const noSleep = () => Promise.resolve();

describe("withStageRetry", () => {
  test("refuses to wrap a stage that is not idempotent, at wrap time", () => {
    const stage = { name: "write_sheet_jobs", run: () => {} };
    // @ts-expect-error — the type system already blocks this; the runtime guard covers JS callers.
    expect(() => withStageRetry(stage, { idempotent: false })).toThrow(/not idempotent/i);
    // @ts-expect-error — missing declaration is also refused.
    expect(() => withStageRetry(stage, {})).toThrow(/not idempotent/i);
    expect(() => withStageRetry(null as never, { idempotent: true })).toThrow(/JobStage/);
  });

  test("bounds are validated at wrap time, not mid-pipeline", () => {
    const stage = { name: "write_sheet_jobs", run: () => {} };
    for (const attempts of [0, 9, 1.5, Number.NaN])
      expect(() => withStageRetry(stage, { idempotent: true, attempts })).toThrow(
        /Invalid retry bound/,
      );
    for (const baseDelayMs of [-1, Number.NaN])
      expect(() => withStageRetry(stage, { idempotent: true, baseDelayMs })).toThrow(/finite ms/);
  });

  test("a transient failure retries and the stage records ok with full counts", async () => {
    // Mirrors execution 5d2b848b: the sheet write hits a 429 once, then the
    // retry completes the batch. Idempotent upsert => final rowsOut is the
    // committed window, not a sum over attempts.
    let calls = 0;
    const stage = withStageRetry(
      {
        name: "write_sheet_jobs",
        run: (c: StageCounts) => {
          calls++;
          c.rowsIn = 1150;
          if (calls === 1) {
            c.rowsOut = 340; // partial commit before the API rejected the batch
            throw new Error("Sheets API 429: quota exceeded");
          }
          c.rowsOut = 1150; // retry rewrites the same window by key
        },
      },
      { idempotent: true, sleep: noSleep },
    );
    const record = await runJobStages({ logLine: false, stages: [stage] });
    expect(calls).toBe(2);
    expect(record.status).toBe("ok");
    expect(record.rowsOut).toBe(1150);
    expect(record.stages[0]).toMatchObject({
      stage: "write_sheet_jobs",
      status: "ok",
      rowsIn: 1150,
      rowsOut: 1150,
    });
  });

  test("counts persist across attempts so a stage can resume a partial write", async () => {
    const committed: number[] = [];
    const stage = withStageRetry(
      {
        name: "write_sheet_jobs",
        run: (c: StageCounts) => {
          // Append-style stage resuming from its own rowsOut cursor.
          const resumeFrom = c.rowsOut;
          if (resumeFrom === 0) {
            c.rowsOut = 400;
            throw new Error("timeout");
          }
          committed.push(resumeFrom);
          c.rowsOut = 1150;
        },
      },
      { idempotent: true, sleep: noSleep },
    );
    const record = await runJobStages({ logLine: false, stages: [stage] });
    expect(record.status).toBe("ok");
    expect(committed).toEqual([400]); // second attempt resumed at 400, not 0
    expect(record.rowsOut).toBe(1150);
  });

  test("gives up after the attempt cap and rethrows the last error", async () => {
    let calls = 0;
    const stage = withStageRetry(
      {
        name: "write_sheet_jobs",
        run: () => {
          calls++;
          throw new Error(`failure ${calls}`);
        },
      },
      { idempotent: true, attempts: 3, sleep: noSleep },
    );
    const record = await runJobStages({ logLine: false, stages: [stage] });
    expect(calls).toBe(3);
    expect(record.status).toBe("error");
    expect(record.lastError).toEqual({ stage: "write_sheet_jobs", message: "failure 3" });
  });

  test("the when filter stops retrying non-transient errors immediately", async () => {
    let calls = 0;
    const stage = withStageRetry(
      {
        name: "write_sheet_jobs",
        run: () => {
          calls++;
          throw new Error("Sheets API 400: range is read-only");
        },
      },
      {
        idempotent: true,
        sleep: noSleep,
        when: (error) => !(error instanceof Error && error.message.includes(" 400:")),
      },
    );
    const record = await runJobStages({ logLine: false, stages: [stage] });
    expect(calls).toBe(1);
    expect(record.status).toBe("error");
  });

  test("backoff doubles the wait per attempt, capped at maxDelayMs", async () => {
    const waits: number[] = [];
    const retries: number[] = [];
    const stage = withStageRetry(
      {
        name: "write_sheet_jobs",
        run: () => {
          throw new Error("boom");
        },
      },
      {
        idempotent: true,
        attempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 250,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        onRetry: (attempt) => retries.push(attempt),
      },
    );
    await runJobStages({ logLine: false, stages: [stage] });
    expect(waits).toEqual([100, 200, 250]); // 400 would exceed the 250 cap
    expect(retries).toEqual([2, 3, 4]);
  });
});
