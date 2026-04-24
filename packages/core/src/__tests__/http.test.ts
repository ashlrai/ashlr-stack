import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchWithRetry, parseRetryAfter } from "../http.ts";

/**
 * `fetchWithRetry` is the single retry loop the rest of core leans on. If it
 * regressed (retrying POSTs, ignoring Retry-After, infinite loop on 5xx) we'd
 * either over-charge provider APIs or burn through rate-limit budgets. These
 * tests exercise each of the contract guarantees.
 */

describe("fetchWithRetry", () => {
  let realFetch: typeof fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("happy path — returns the first successful response, no retry", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com/", undefined, {
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  test("429 triggers a retry, then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("rate limited", { status: 429 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com/", undefined, {
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("500 retries `retries` times then returns the final failing response", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("server error", { status: 500 });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com/", undefined, {
      retries: 2,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    expect(res.status).toBe(500);
    // 1 initial + 2 retries = 3 total
    expect(calls).toBe(3);
  });

  test("honors Retry-After header (integer seconds form)", async () => {
    let calls = 0;
    const timestamps: number[] = [];
    globalThis.fetch = (async () => {
      calls++;
      timestamps.push(Date.now());
      if (calls === 1) {
        return new Response("slow down", {
          status: 429,
          headers: { "retry-after": "1" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const start = Date.now();
    const res = await fetchWithRetry("https://example.com/", undefined, {
      baseDelayMs: 10,
      // Cap is high enough to let the 1-second Retry-After pass through.
      maxDelayMs: 5000,
    });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    // Server said to wait 1 second. We should have waited roughly that — at
    // minimum significantly longer than the 10ms baseDelayMs we configured.
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(calls).toBe(2);
  });

  test("POST does NOT retry by default (non-idempotent)", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("server error", { status: 500 });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry(
      "https://example.com/charge",
      { method: "POST", body: "{}" },
      { retries: 3, baseDelayMs: 1, maxDelayMs: 2 },
    );
    // Got back the 500 on the first try — never retried.
    expect(res.status).toBe(500);
    expect(calls).toBe(1);
  });

  test("idempotent: true overrides method-based default, letting a POST retry", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("nope", { status: 503 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry(
      "https://example.com/graphql",
      { method: "POST", body: '{"query":"{ me { id } }"}' },
      { idempotent: true, baseDelayMs: 1, maxDelayMs: 2 },
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("network errors retry for idempotent requests", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com/", undefined, {
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("network errors on non-idempotent requests bubble up immediately", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(
      fetchWithRetry(
        "https://example.com/charge",
        { method: "POST", body: "{}" },
        { retries: 3, baseDelayMs: 1, maxDelayMs: 2 },
      ),
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(1);
  });

  test("custom retryOn is respected", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("teapot", { status: 418 });
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com/", undefined, {
      retries: 2,
      baseDelayMs: 1,
      maxDelayMs: 2,
      retryOn: (r) => r.status === 418,
    });
    expect(res.status).toBe(418);
    expect(calls).toBe(3); // initial + 2 retries
  });

  test("respects an external AbortSignal and stops mid-retry", async () => {
    let calls = 0;
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      calls++;
      // Abort once we've made it past the initial try — the subsequent sleep
      // should be interrupted, not slept through.
      setTimeout(() => controller.abort(), 5);
      return new Response("slow", { status: 503 });
    }) as unknown as typeof fetch;

    await expect(
      fetchWithRetry("https://example.com/", undefined, {
        retries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 2000,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    // At least one call happened; we aborted before burning through all 5 retries.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThan(6);
  });
});

describe("parseRetryAfter", () => {
  test("parses integer seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  test("returns undefined for empty / null", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("   ")).toBeUndefined();
  });

  test("parses HTTP-date form", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).toBeDefined();
    // Allow drift from test overhead; we just need it to be in the right ballpark.
    expect(parsed as number).toBeGreaterThan(5_000);
    expect(parsed as number).toBeLessThanOrEqual(12_000);
  });

  test("HTTP-date in the past clamps to 0", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  test("garbage input falls through to undefined", () => {
    expect(parseRetryAfter("not-a-date-or-number")).toBeUndefined();
  });
});
