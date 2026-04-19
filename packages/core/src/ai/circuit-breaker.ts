/**
 * Minimal circuit breaker — stop hammering an inference backend after it
 * racks up consecutive failures inside a rolling window.
 *
 * Zero deps. Shape adapted from `ashlrcode/src/providers/retry.ts` but
 * trimmed: we only need a rolling failure window and three states.
 *
 * State machine:
 *   closed    → normal traffic. Failures are counted inside `windowMs`.
 *   open      → `canRequest()` returns false until `resetTimeMs` elapses
 *               since the last recorded failure.
 *   half-open → one probe is allowed. Success closes the circuit;
 *               failure re-opens it and restarts the cooldown.
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures in `windowMs` required to trip the breaker. */
  threshold?: number;
  /** Rolling window in ms for counting failures before tripping. */
  windowMs?: number;
  /** Ms to stay open before allowing a half-open probe. */
  resetTimeMs?: number;
  /** Override time source — tests pass a fake clock. */
  now?: () => number;
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly resetTimeMs: number;
  private readonly now: () => number;

  private state: CircuitState = "closed";
  private failureTimes: number[] = [];
  private lastFailureTime = 0;
  private probeInFlight = false;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.threshold ?? 3;
    this.windowMs = opts.windowMs ?? 60_000;
    // Default reset matches the failure window: once we've stayed quiet for
    // the window we probe again. Callers can override independently.
    this.resetTimeMs = opts.resetTimeMs ?? this.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Returns true if a new request should be attempted. */
  canRequest(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      if (this.now() - this.lastFailureTime >= this.resetTimeMs) {
        this.state = "half-open";
        this.probeInFlight = true;
        return true;
      }
      return false;
    }

    // half-open: only one probe at a time.
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.failureTimes = [];
    this.state = "closed";
    this.probeInFlight = false;
  }

  recordFailure(): void {
    const now = this.now();
    this.probeInFlight = false;
    this.lastFailureTime = now;

    // Half-open failures re-open immediately without needing to re-hit
    // the threshold — one bad probe is enough.
    if (this.state === "half-open") {
      this.state = "open";
      this.failureTimes = [now];
      return;
    }

    this.failureTimes.push(now);
    const cutoff = now - this.windowMs;
    while (this.failureTimes.length && this.failureTimes[0]! < cutoff) {
      this.failureTimes.shift();
    }
    if (this.failureTimes.length >= this.threshold) {
      this.state = "open";
    }
  }

  /** Observable state. Resolves time-based transitions lazily. */
  getState(): CircuitState {
    if (
      this.state === "open" &&
      this.now() - this.lastFailureTime >= this.resetTimeMs
    ) {
      this.state = "half-open";
    }
    return this.state;
  }

  /** Current failure count inside the rolling window. */
  getFailureCount(): number {
    const cutoff = this.now() - this.windowMs;
    while (this.failureTimes.length && this.failureTimes[0]! < cutoff) {
      this.failureTimes.shift();
    }
    return this.failureTimes.length;
  }
}
