/**
 * Run independent `stack status` probes together.
 * A slow probe times out on its own. Results stay in input order.
 */

/** One probe cannot hold the command longer than this. */
export const STATUS_CHECK_TIMEOUT_MS = 2_000;

/** How many probes may run at once. Status only has a few. */
export const STATUS_CHECK_CONCURRENCY = 3;

export class StatusCheckTimeoutError extends Error {
  readonly checkName: string;
  readonly timeoutMs: number;

  constructor(checkName: string, timeoutMs: number) {
    super(`status check ${checkName} timed out after ${timeoutMs}ms`);
    this.name = "StatusCheckTimeoutError";
    this.checkName = checkName;
    this.timeoutMs = timeoutMs;
  }
}

export interface StatusCheck<T> {
  name: string;
  run: () => Promise<T>;
}

export type StatusCheckResult<T> =
  | { name: string; state: "ok"; value: T }
  | { name: string; state: "error"; error: unknown }
  | { name: string; state: "timeout"; error: StatusCheckTimeoutError };

export interface StatusCheckRunOptions {
  timeoutMs: number;
  concurrency: number;
}

/**
 * Run `checks` in batches of `concurrency`. Each batch uses `Promise.allSettled`,
 * so one rejection does not cancel the rest. The returned array matches input order.
 */
export async function runStatusChecks<T>(
  checks: readonly StatusCheck<T>[],
  opts: StatusCheckRunOptions,
): Promise<Array<StatusCheckResult<T>>> {
  const results: Array<StatusCheckResult<T>> = [];
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  for (let start = 0; start < checks.length; start += concurrency) {
    const batch = checks.slice(start, start + concurrency);
    const settled = await Promise.allSettled(
      batch.map((check) => withTimeout(check.name, check.run(), opts.timeoutMs)),
    );
    for (let i = 0; i < batch.length; i++) {
      const check = batch[i];
      const item = settled[i];
      if (!check || !item) continue;
      results.push(toResult(check.name, item));
    }
  }
  return results;
}

function toResult<T>(name: string, item: PromiseSettledResult<T>): StatusCheckResult<T> {
  if (item.status === "fulfilled") return { name, state: "ok", value: item.value };
  if (item.reason instanceof StatusCheckTimeoutError) {
    return { name, state: "timeout", error: item.reason };
  }
  return { name, state: "error", error: item.reason };
}

function withTimeout<T>(name: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StatusCheckTimeoutError(name, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
