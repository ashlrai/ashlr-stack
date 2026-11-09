import type { JobStage } from "./job-run.ts";

/**
 * stage-retry.ts — bounded, idempotent-only retry for pipeline stages.
 *
 * Motivation: stacksync execution 5d2b848b died inside `write_sheet_jobs` on a
 * 429 mid-batch. The correct response to a transient sheet-API failure is a
 * retry — but retry is only safe when re-running the stage cannot double-apply
 * rows. This wrapper makes that contract explicit: the caller must declare
 * `idempotent: true`, meaning the stage upserts a fixed key window or rewrites
 * the same row range rather than appending blindly.
 *
 * The same `StageCounts` instance is passed on every attempt, so a stage may
 * also treat `counts.rowsOut` as a resume cursor: after a partial commit the
 * next attempt can continue where it stopped instead of restarting the batch.
 *
 * Retry metadata is observational only: the wrapped stage still reports one
 * StageTiming in the job-run record; an `onRetry` hook lets the caller log
 * each wait without changing the record shape.
 */

export interface StageRetryOptions {
  /**
   * Required acknowledgment that re-running the stage cannot duplicate rows:
   * the write must be keyed upsert / fixed-window rewrite, or the stage must
   * resume from its own `counts.rowsOut`. This is a compile-time literal —
   * JavaScript callers get a runtime check instead.
   */
  idempotent: true;
  /** Total attempts including the first run (default 3, max 8). */
  attempts?: number;
  /** Wait before the first retry in ms; each subsequent wait doubles (default 250). */
  baseDelayMs?: number;
  /** Cap on a single retry wait in ms (default 30_000). */
  maxDelayMs?: number;
  /**
   * Return false for errors that must not be retried (e.g. a permanent 4xx
   * schema rejection). Default retries every error.
   */
  when?: (error: unknown, attempt: number) => boolean;
  /**
   * Called just before each retry wait with the upcoming attempt number
   * (2-based), the computed delay and the error that caused it. For logging;
   * must not throw — a throwing hook is treated as a stage error.
   */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  /** Injectable sleep for tests; defaults to a setTimeout promise. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 8;
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const positiveInt = (value: number | undefined, fallback: number, max: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`Invalid retry bound ${value}; expected 1..${max}`);
  return value;
};

const positiveMs = (value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error("Retry delays must be finite ms >= 0");
  return value;
};

/**
 * Return a `JobStage` that reruns `stage` on failure, up to `attempts` total
 * tries with exponential backoff. Throws at wrap time — not mid-pipeline —
 * when `idempotent` is not `true` or the bounds are invalid, so a misconfigured
 * job fails fast on startup rather than inside a run.
 */
export function withStageRetry(stage: JobStage, options: StageRetryOptions): JobStage {
  if (options?.idempotent !== true)
    throw new Error(
      `withStageRetry(${stage?.name ?? "stage"}): refusing to retry a stage that is not idempotent; re-running a blind append would duplicate rows`,
    );
  if (!stage || typeof stage.name !== "string" || typeof stage.run !== "function")
    throw new Error("withStageRetry: expected a JobStage { name, run }");
  const attempts = positiveInt(options.attempts, 3, MAX_ATTEMPTS);
  const baseDelayMs = positiveMs(options.baseDelayMs, 250);
  const maxDelayMs = positiveMs(options.maxDelayMs, 30_000);
  const sleep = options.sleep ?? realSleep;
  const when = options.when ?? (() => true);

  return {
    name: stage.name,
    run: async (counts) => {
      let attempt = 1;
      for (;;) {
        try {
          await stage.run(counts);
          return;
        } catch (error) {
          if (attempt >= attempts || !when(error, attempt)) throw error;
          const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
          attempt += 1;
          options.onRetry?.(attempt, delay, error);
          await sleep(delay);
        }
      }
    },
  };
}
