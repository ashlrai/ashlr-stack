import { describe, expect, test } from "bun:test";
import { CircuitBreaker } from "../ai/circuit-breaker.ts";

/**
 * Circuit breaker state-transition tests. These lean on an injectable
 * clock so we can reason deterministically about the rolling window
 * without actually sleeping.
 */

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("CircuitBreaker", () => {
  test("starts closed and allows requests", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.canRequest()).toBe(true);
  });

  test("opens after threshold consecutive failures inside the window", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ threshold: 3, windowMs: 60_000, now: clock.now });

    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.canRequest()).toBe(false);
  });

  test("ignores stale failures outside the rolling window", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ threshold: 3, windowMs: 60_000, now: clock.now });

    cb.recordFailure();
    cb.recordFailure();
    // Move past the window; the first two should no longer count.
    clock.advance(61_000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.getFailureCount()).toBe(2);
  });

  test("transitions open → half-open after resetTimeMs", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      threshold: 2,
      windowMs: 60_000,
      resetTimeMs: 30_000,
      now: clock.now,
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.canRequest()).toBe(false);

    clock.advance(30_001);
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState()).toBe("half-open");
    // Only one probe at a time.
    expect(cb.canRequest()).toBe(false);
  });

  test("half-open success closes the circuit; failure re-opens it", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      threshold: 2,
      windowMs: 60_000,
      resetTimeMs: 1_000,
      now: clock.now,
    });

    cb.recordFailure();
    cb.recordFailure();
    clock.advance(1_001);
    expect(cb.canRequest()).toBe(true);
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.canRequest()).toBe(true);

    // Trip again, probe again, this time the probe fails.
    cb.recordFailure();
    cb.recordFailure();
    clock.advance(1_001);
    expect(cb.canRequest()).toBe(true); // half-open probe
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.canRequest()).toBe(false);
  });

  test("success resets the failure count", () => {
    const cb = new CircuitBreaker({ threshold: 3, windowMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
  });
});
