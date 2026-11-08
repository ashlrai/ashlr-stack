import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * job-run.ts — per-execution structured result records for fleet jobs.
 *
 * Motivation: stacksync execution 5d2b848b died inside `write_sheet_jobs` and
 * the only artifact was an unstructured error line — remotely we could not
 * tell which stage failed, how long each stage took, or how many rows were
 * pulled vs. committed. Every staged job run now ends with one JobRunRecord:
 * per-stage timings, rows in/out, and the last error tagged with its stage.
 *
 * The record is emitted as a single-line JSON log (greppable in journald or
 * any log drain) and, when `tablePath` is set, appended as one row to a JSONL
 * table that `readFleetJsonl` / `jq` can query. Records carry counts and a
 * bounded, flattened error message — never row payloads.
 */

export const JOB_RUN_SCHEMA = "fleet.job-run.v1";

/** Stacksync's fixed pipeline order: source read → row transform → sheet write. */
export const SYNC_STAGES = ["read_postgres", "transform", "write_sheet_jobs"] as const;
export type SyncStageName = (typeof SYNC_STAGES)[number];

export type StageStatus = "ok" | "error" | "skipped";

export interface StageTiming {
  stage: string;
  status: StageStatus;
  /** Wall time of the stage; null when the stage never ran (skipped). */
  durationMs: number | null;
  /** Rows the stage consumed. */
  rowsIn: number;
  /** Rows the stage produced; on a failed write this is the partial commit count. */
  rowsOut: number;
}

export interface JobRunError {
  stage: string;
  message: string;
}

export interface JobRunRecord {
  schema: typeof JOB_RUN_SCHEMA;
  job: string;
  executionId: string;
  /** Sync direction for two-way jobs, e.g. "postgres->sheets"; null when unset. */
  direction: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "ok" | "error";
  /** Rows that entered the pipeline: the first stage's input, or its output when
   * it is a source stage (read_postgres reports only rowsOut). */
  rowsIn: number;
  /** Rows the pipeline emitted: the last attempted stage's output — partial on failure. */
  rowsOut: number;
  stages: StageTiming[];
  lastError: JobRunError | null;
  /** Set when the JSONL table append failed; the log line is then the only copy. */
  persistError: string | null;
}

/** Mutable counters handed to a stage; partial values survive a throw. */
export interface StageCounts {
  rowsIn: number;
  rowsOut: number;
}

export interface JobStage {
  name: string;
  run: (counts: StageCounts) => void | Promise<void>;
}

export interface RunJobOptions {
  stages: readonly JobStage[];
  /** Job name stamped on the record. Default "stacksync". */
  job?: string;
  /** Caller-assigned execution id (e.g. "5d2b848b"); defaults to a random 8-hex id. */
  executionId?: string;
  /** Sync direction label, e.g. "postgres->sheets". */
  direction?: string;
  /** JSONL table path; when set the record is appended as one line. */
  tablePath?: string;
  /** Log-line sink; default writes one JSON line to stdout. Pass `false` to silence. */
  logLine?: ((line: string) => void) | false;
  /** Wall clock for ISO stamps and durations (ms); default Date.now. */
  now?: () => number;
}

/** Cap on recorded error text — provider error bodies can be kilobytes. */
const MAX_ERROR_MESSAGE = 500;

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ERROR_MESSAGE ? `${flat.slice(0, MAX_ERROR_MESSAGE)}...` : flat;
}

/** Junk counts (negative, non-finite) record as 0 — a record must never carry NaN. */
const rowCount = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const defaultLogLine = (line: string): void => console.log(line);

/** Append one record to a JSONL table, creating the parent directory as needed. */
export async function appendJobRunRecord(path: string, record: JobRunRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Run `stages` in order and return the execution record. The record — not a
 * throw — is the outcome: callers branch on `record.status` /
 * `record.lastError`. A stage that throws ends the run; the failing stage's
 * timing and partial counts are kept, later stages are marked "skipped", and
 * the record is still emitted so a remote run leaves evidence.
 */
export async function runJobStages(options: RunJobOptions): Promise<JobRunRecord> {
  const now = options.now ?? Date.now;
  const startMs = now();
  const timings: StageTiming[] = [];
  let lastError: JobRunError | null = null;

  for (const stage of options.stages) {
    if (lastError !== null) {
      timings.push({
        stage: stage.name,
        status: "skipped",
        durationMs: null,
        rowsIn: 0,
        rowsOut: 0,
      });
      continue;
    }
    const counts: StageCounts = { rowsIn: 0, rowsOut: 0 };
    const stageStart = now();
    try {
      await stage.run(counts);
      timings.push({
        stage: stage.name,
        status: "ok",
        durationMs: Math.max(0, Math.round(now() - stageStart)),
        rowsIn: rowCount(counts.rowsIn),
        rowsOut: rowCount(counts.rowsOut),
      });
    } catch (error) {
      timings.push({
        stage: stage.name,
        status: "error",
        durationMs: Math.max(0, Math.round(now() - stageStart)),
        rowsIn: rowCount(counts.rowsIn),
        rowsOut: rowCount(counts.rowsOut),
      });
      lastError = { stage: stage.name, message: errorMessage(error) };
    }
  }

  const endMs = now();
  const attempted = timings.filter((t) => t.status !== "skipped");
  const first = attempted[0];
  const last = attempted[attempted.length - 1];
  const record: JobRunRecord = {
    schema: JOB_RUN_SCHEMA,
    job: options.job ?? "stacksync",
    executionId: options.executionId ?? crypto.randomUUID().slice(0, 8),
    direction: options.direction ?? null,
    startedAt: new Date(startMs).toISOString(),
    finishedAt: new Date(endMs).toISOString(),
    durationMs: Math.max(0, Math.round(endMs - startMs)),
    status: lastError === null ? "ok" : "error",
    rowsIn: first ? first.rowsIn || first.rowsOut : 0,
    rowsOut: last?.rowsOut ?? 0,
    stages: timings,
    lastError,
    persistError: null,
  };

  if (options.tablePath) {
    try {
      await appendJobRunRecord(options.tablePath, record);
    } catch (error) {
      record.persistError = errorMessage(error);
    }
  }

  const sink = options.logLine === undefined ? defaultLogLine : options.logLine;
  if (sink) sink(JSON.stringify(record));
  return record;
}
