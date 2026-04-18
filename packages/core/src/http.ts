/**
 * Retry-with-backoff wrapper for `fetch`. Used by provider healthchecks and
 * read-only API calls; NEVER wire this in on mutating requests (POST / PUT /
 * PATCH / DELETE) unless the caller explicitly opts in via `idempotent: true`
 * — we'd rather surface a failure than risk double-charging a provider API or
 * duplicating an upstream resource.
 *
 * Design notes:
 *   - Pure dependency: `globalThis.fetch` + `setTimeout`. No new runtime deps.
 *   - Honors `Retry-After` (both integer-seconds and HTTP-date formats).
 *   - Exponential backoff with jitter so a flock of retries doesn't stampede.
 *   - Abortable via the passed `AbortSignal` — stops the loop between attempts.
 */

export interface RetryOptions {
  /** How many retry attempts (after the initial try). Default: 3. */
  retries?: number;
  /** Base delay in ms for the exponential backoff. Default: 400. */
  baseDelayMs?: number;
  /** Cap on a single sleep interval (before jitter). Default: 8000. */
  maxDelayMs?: number;
  /**
   * Predicate deciding whether a non-ok Response should be retried. Default
   * matches the common "transient" set: 429, 500, 502, 503, 504.
   */
  retryOn?: (res: Response) => boolean;
  /**
   * Whether the caller considers the request safe to retry. If omitted, we
   * derive from `init.method`: GET and HEAD are idempotent, everything else
   * is not. Set this explicitly for edge cases (e.g. a PUT to a versioned
   * URL that the caller knows is safe).
   */
  idempotent?: boolean;
  /** Caller-supplied abort signal. Cancels both the active fetch and any pending sleep. */
  signal?: AbortSignal;
}

const DEFAULT_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export function defaultRetryOn(res: Response): boolean {
  return DEFAULT_RETRY_STATUSES.has(res.status);
}

/**
 * Drop-in replacement for `fetch` that retries idempotent requests on
 * transient failures. Returns the final `Response` — callers still check
 * `.ok` themselves. Non-idempotent methods (POST/PUT/PATCH/DELETE) are
 * executed exactly once unless `idempotent: true` is passed.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const retryOn = opts.retryOn ?? defaultRetryOn;
  const idempotent = opts.idempotent ?? isIdempotent(init?.method);
  const signal = opts.signal;

  let attempt = 0;
  // Track the last non-ok response so a final failure returns something the
  // caller can inspect (status / body) rather than a synthetic error.
  let lastResponse: Response | undefined;
  let lastError: unknown;

  while (true) {
    if (signal?.aborted) throw abortError(signal);

    try {
      const res = await fetch(input, mergeSignal(init, signal));
      if (res.ok || !idempotent || !retryOn(res)) return res;

      lastResponse = res;
      if (attempt >= retries) return res;

      const waitMs = computeDelay(res, attempt, baseDelayMs, maxDelayMs);
      await sleep(waitMs, signal);
      attempt++;
      continue;
    } catch (err) {
      // Network-level failure (DNS, connection reset, fetch threw). Only retry
      // for idempotent requests — a POST that "failed" may have actually been
      // accepted by the remote before the connection dropped.
      if (isAbortError(err)) throw err;
      lastError = err;
      if (!idempotent || attempt >= retries) throw err;
      const waitMs = computeDelay(undefined, attempt, baseDelayMs, maxDelayMs);
      await sleep(waitMs, signal);
      attempt++;
      continue;
    }
  }

  // Unreachable — both branches above either return or throw. The assignment
  // to lastResponse/lastError keeps TS happy if the loop ever changes shape.
  void lastResponse;
  void lastError;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isIdempotent(method?: string): boolean {
  if (!method) return true; // fetch defaults to GET
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD";
}

/**
 * Exponential backoff with jitter, overridden by a server-supplied
 * `Retry-After` if present. Jitter prevents thundering-herd when a burst of
 * callers all see the same 429 and pick the same deterministic delay.
 */
function computeDelay(
  res: Response | undefined,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  if (res) {
    const header = res.headers.get("retry-after");
    const parsed = parseRetryAfter(header);
    if (parsed !== undefined) return Math.max(0, Math.min(parsed, maxDelayMs * 4));
  }
  const exp = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = Math.random() * baseDelayMs;
  return exp + jitter;
}

/**
 * Parse a Retry-After header. The spec allows either a non-negative integer
 * (seconds) or an HTTP-date (RFC 7231). Returns ms, or undefined if we can't
 * parse it — callers then fall back to exponential backoff.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;

  // Integer-seconds form.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }

  // HTTP-date form. Date.parse understands RFC 7231 formats; if it fails it
  // returns NaN and we fall through.
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }

  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Merge a caller-supplied `AbortSignal` into the `init.signal` passed to
 * `fetch`. If both are set, either aborting should cancel the request. Using
 * `AbortSignal.any` where available; falling back to a manual linkage on older
 * runtimes.
 */
function mergeSignal(init: RequestInit | undefined, external?: AbortSignal): RequestInit | undefined {
  if (!external) return init;
  const existing = init?.signal ?? undefined;
  if (!existing) return { ...init, signal: external };
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return { ...init, signal: anyFn([existing, external]) };
  }
  // Manual linkage fallback.
  const controller = new AbortController();
  const onAbort = (signal: AbortSignal) => () => controller.abort(signal.reason);
  existing.addEventListener("abort", onAbort(existing), { once: true });
  external.addEventListener("abort", onAbort(external), { once: true });
  if (existing.aborted) controller.abort(existing.reason);
  if (external.aborted) controller.abort(external.reason);
  return { ...init, signal: controller.signal };
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(typeof reason === "string" ? reason : "The operation was aborted.");
  err.name = "AbortError";
  return err;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
