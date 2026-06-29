/**
 * Tests for packages/core/src/errors/provision-errors.ts
 *
 * Covers:
 *  - Error classification (15+ scenarios)
 *  - Hint accuracy per code
 *  - sanitizeBody redaction
 *  - captureProvisionError round-trip (report shape + persistence)
 *  - buildReplayRecord / saveReplayRecord / loadReplayRecord idempotence
 *  - loadProvisionErrorReport round-trip
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReplayRecord,
  captureProvisionError,
  classifyError,
  loadProvisionErrorReport,
  loadReplayRecord,
  sanitizeBody,
  saveReplayRecord,
  type ProvisionErrorCode,
  type ProvisionErrorReport,
} from "../errors/provision-errors.ts";
import { StackError } from "../errors.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErr(message: string, code?: string): Error {
  if (code) {
    const e = new StackError(code, message);
    return e;
  }
  return new Error(message);
}

// ---------------------------------------------------------------------------
// classifyError — 15+ scenarios
// ---------------------------------------------------------------------------

describe("classifyError", () => {
  const cases: Array<[string, string | undefined, ProvisionErrorCode]> = [
    // Auth
    ["401 Unauthorized", undefined, "AUTH_EXPIRED"],
    ["Token expired, please re-authenticate", undefined, "AUTH_EXPIRED"],
    ["auth expired", undefined, "AUTH_EXPIRED"],
    ["unauthenticated request", undefined, "AUTH_EXPIRED"],
    ["No token provided", undefined, "AUTH_MISSING"],
    ["missing api key", undefined, "AUTH_MISSING"],

    // Quota / rate
    ["quota exceeded for your plan", undefined, "QUOTA_EXCEEDED"],
    ["billing limit reached, upgrade required", undefined, "QUOTA_EXCEEDED"],
    ["429 Too Many Requests", undefined, "RATE_LIMITED"],
    ["rate limit exceeded", undefined, "RATE_LIMITED"],

    // Resource conflict
    ["409 Conflict: resource already exists", undefined, "RESOURCE_CONFLICT"],
    ["project already exists", undefined, "RESOURCE_CONFLICT"],

    // HTTP 5xx / degraded
    ["500 Internal Server Error", undefined, "API_DEGRADED"],
    ["503 Service Unavailable", undefined, "API_DEGRADED"],
    ["bad gateway returned from provider", undefined, "API_DEGRADED"],

    // Timeout
    ["PROVISION_TIMEOUT", "PROVISION_TIMEOUT", "TIMEOUT"],
    ["request timed out after 30s", undefined, "TIMEOUT"],
    ["ETIMEDOUT connecting to api.stripe.com", undefined, "TIMEOUT"],

    // Network
    ["ECONNREFUSED 127.0.0.1:443", undefined, "NETWORK_ERROR"],
    ["ENOTFOUND api.provider.io", undefined, "NETWORK_ERROR"],

    // Permission
    ["403 Forbidden", undefined, "PERMISSION_DENIED"],
    ["access denied to this resource", undefined, "PERMISSION_DENIED"],

    // Not found
    ["404 Not Found", undefined, "NOT_FOUND"],

    // Validation
    ["422 Unprocessable Entity: invalid param", undefined, "VALIDATION_FAILED"],

    // Schema mismatch (Stack-native)
    ["PROVISION_SCHEMA_MISMATCH", "PROVISION_SCHEMA_MISMATCH", "INVALID_SCHEMA_RESPONSE"],
    ["malformed JSON response from provider", undefined, "INVALID_SCHEMA_RESPONSE"],
  ];

  for (const [message, code, expected] of cases) {
    test(`classifies "${message}" → ${expected}`, () => {
      const err = makeErr(message, code);
      expect(classifyError(err)).toBe(expected);
    });
  }

  test("falls back to UNKNOWN for unrecognised messages", () => {
    expect(classifyError(new Error("some totally opaque error xyz"))).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// sanitizeBody
// ---------------------------------------------------------------------------

describe("sanitizeBody", () => {
  test("redacts secret-looking keys", () => {
    const body = {
      api_key: "sk-real-secret",
      token: "tok-abc",
      name: "my-project",
      nested: { password: "hunter2", label: "visible" },
    };
    const out = sanitizeBody(body) as Record<string, unknown>;
    expect(out.api_key).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect(out.name).toBe("my-project");
    const nested = out.nested as Record<string, unknown>;
    expect(nested.password).toBe("[REDACTED]");
    expect(nested.label).toBe("visible");
  });

  test("truncates long strings to 200 chars + ellipsis", () => {
    const long = "a".repeat(250);
    const out = sanitizeBody(long) as string;
    expect(out.length).toBeLessThanOrEqual(204); // 200 + "…"
    expect(out.endsWith("…")).toBe(true);
  });

  test("passes through null and primitives", () => {
    expect(sanitizeBody(null)).toBeNull();
    expect(sanitizeBody(42)).toBe(42);
    expect(sanitizeBody(true)).toBe(true);
  });

  test("handles arrays recursively", () => {
    const arr = [{ secret: "s", visible: "v" }, { other: "x" }];
    const out = sanitizeBody(arr) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe("[REDACTED]");
    expect(out[0]!.visible).toBe("v");
    expect(out[1]!.other).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// captureProvisionError — report shape
// ---------------------------------------------------------------------------

describe("captureProvisionError", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "stack-provision-err-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("returns a well-formed ProvisionErrorReport", () => {
    const err = new Error("quota exceeded for your plan");
    const report = captureProvisionError(
      err,
      { providerName: "stripe", stepName: "provision", attemptCount: 2, elapsedMs: 1500 },
      cwd,
    );

    expect(report.code).toBe("QUOTA_EXCEEDED");
    expect(report.title).toBe("Quota exceeded");
    expect(report.providerName).toBe("stripe");
    expect(report.stepName).toBe("provision");
    expect(report.attemptCount).toBe(2);
    expect(report.elapsedMs).toBe(1500);
    expect(report.rawError).toBe("quota exceeded for your plan");
    expect(report.hints.length).toBeGreaterThan(0);
    expect(typeof report.errorId).toBe("string");
    expect(report.errorId.length).toBe(12);
    expect(typeof report.timestamp).toBe("string");
    // timestamp is ISO 8601
    expect(new Date(report.timestamp).getTime()).toBeGreaterThan(0);
  });

  test("persists report JSON to .stack/errors/", async () => {
    const err = new Error("401 Unauthorized");
    const report = captureProvisionError(
      err,
      { providerName: "vercel", stepName: "login" },
      cwd,
    );

    // The file should exist
    const errDir = join(cwd, ".stack", "errors");
    const { readdirSync, readFileSync } = await import("node:fs");
    const files = readdirSync(errDir).filter(
      (f: string) => f.includes(report.errorId) && f.endsWith(".json") && !f.endsWith(".replay.json"),
    );
    expect(files.length).toBe(1);
    const parsed = JSON.parse(readFileSync(join(errDir, files[0]!), "utf-8")) as ProvisionErrorReport;
    expect(parsed.errorId).toBe(report.errorId);
    expect(parsed.code).toBe("AUTH_EXPIRED");
  });

  test("sanitizes request snapshot before persisting", async () => {
    const err = new Error("500 server error");
    const report = captureProvisionError(
      err,
      {
        providerName: "neon",
        stepName: "provision",
        request: {
          method: "POST",
          url: "https://api.neon.tech/v1/projects",
          body: { api_key: "secret-key", name: "my-db" },
          statusCode: 500,
          responseBody: { error: "internal error" },
        },
      },
      cwd,
    );

    expect(report.request).toBeDefined();
    const body = report.request!.body as Record<string, unknown>;
    expect(body.api_key).toBe("[REDACTED]");
    expect(body.name).toBe("my-db");
  });

  test("includes retry policy for RATE_LIMITED", () => {
    const err = new Error("429 rate limit exceeded");
    const report = captureProvisionError(
      err,
      { providerName: "openai", stepName: "provision" },
      cwd,
    );
    expect(report.retry).toBeDefined();
    expect(report.retry!.backoffMs).toBeGreaterThan(0);
    expect(report.retry!.maxAttempts).toBeGreaterThan(0);
  });

  test("sets contactSupport for API_DEGRADED", () => {
    const err = new Error("503 service unavailable");
    const report = captureProvisionError(
      err,
      { providerName: "supabase", stepName: "provision" },
      cwd,
    );
    expect(report.contactSupport).toBe(true);
  });

  test("handles non-Error thrown values gracefully", () => {
    const report = captureProvisionError(
      "raw string error",
      { providerName: "github", stepName: "materialize" },
      cwd,
    );
    expect(report.rawError).toBe("raw string error");
    expect(report.code).toBe("UNKNOWN");
  });

  test("defaults attemptCount and elapsedMs when not provided", () => {
    const report = captureProvisionError(
      new Error("boom"),
      { providerName: "railway", stepName: "provision" },
      cwd,
    );
    expect(report.attemptCount).toBe(1);
    expect(report.elapsedMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hint accuracy — spot-check key codes
// ---------------------------------------------------------------------------

describe("hint accuracy", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "stack-hints-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  test("AUTH_EXPIRED hints include stack login command", () => {
    const report = captureProvisionError(
      new Error("401 unauthorized"),
      { providerName: "stripe", stepName: "login" },
      cwd,
    );
    const commands = report.hints.map((h) => h.command);
    expect(commands.some((c) => c.includes("stack login stripe"))).toBe(true);
  });

  test("QUOTA_EXCEEDED hints include dashboard open command", () => {
    const report = captureProvisionError(
      new Error("quota exceeded"),
      { providerName: "stripe", stepName: "provision" },
      cwd,
    );
    const commands = report.hints.map((h) => h.command);
    expect(commands.some((c) => c.includes("stack open stripe"))).toBe(true);
  });

  test("TIMEOUT hints include stack add retry command", () => {
    const report = captureProvisionError(
      new Error("timed out"),
      { providerName: "vercel", stepName: "provision" },
      cwd,
    );
    const commands = report.hints.map((h) => h.command);
    expect(commands.some((c) => c.includes("stack add vercel"))).toBe(true);
  });

  test("RESOURCE_CONFLICT hints include --use flag", () => {
    const report = captureProvisionError(
      new Error("409 conflict: project already exists"),
      { providerName: "neon", stepName: "provision" },
      cwd,
    );
    const commands = report.hints.map((h) => h.command);
    expect(commands.some((c) => c.includes("--use"))).toBe(true);
  });

  test("NETWORK_ERROR hints include stack add retry command", () => {
    const report = captureProvisionError(
      new Error("ECONNREFUSED"),
      { providerName: "supabase", stepName: "provision" },
      cwd,
    );
    const commands = report.hints.map((h) => h.command);
    expect(commands.some((c) => c.includes("stack add supabase"))).toBe(true);
  });

  test("unknown provider gets generic dashboard command", () => {
    const report = captureProvisionError(
      new Error("quota exceeded"),
      { providerName: "myprovider", stepName: "provision" },
      cwd,
    );
    const commands = report.hints.map((h) => h.command);
    expect(commands.some((c) => c.includes("stack open myprovider"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Replay record round-trip (idempotence)
// ---------------------------------------------------------------------------

describe("replay record round-trip", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "stack-replay-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  test("save + load round-trips correctly", () => {
    const report = captureProvisionError(
      new Error("timeout"),
      { providerName: "vercel", stepName: "provision", elapsedMs: 30000 },
      cwd,
    );
    const record = buildReplayRecord(report);
    saveReplayRecord(record, cwd);

    const loaded = loadReplayRecord(report.errorId, cwd);
    expect(loaded).toBeDefined();
    expect(loaded!.errorId).toBe(report.errorId);
    expect(loaded!.providerName).toBe("vercel");
    expect(loaded!.stepName).toBe("provision");
    expect(loaded!.requiresFreshAuth).toBe(true); // TIMEOUT is transient
  });

  test("transient errors (TIMEOUT) set requiresFreshAuth=true", () => {
    const report = captureProvisionError(
      new Error("ETIMEDOUT"),
      { providerName: "neon", stepName: "provision" },
      cwd,
    );
    const record = buildReplayRecord(report);
    expect(record.requiresFreshAuth).toBe(true);
  });

  test("non-transient errors (QUOTA_EXCEEDED) set requiresFreshAuth=false", () => {
    const report = captureProvisionError(
      new Error("quota exceeded"),
      { providerName: "openai", stepName: "provision" },
      cwd,
    );
    const record = buildReplayRecord(report);
    expect(record.requiresFreshAuth).toBe(false);
  });

  test("RATE_LIMITED sets requiresFreshAuth=true (transient)", () => {
    const report = captureProvisionError(
      new Error("429 rate limit"),
      { providerName: "stripe", stepName: "provision" },
      cwd,
    );
    const record = buildReplayRecord(report);
    expect(record.requiresFreshAuth).toBe(true);
  });

  test("loadReplayRecord returns undefined for unknown id", () => {
    const loaded = loadReplayRecord("nonexistentid", cwd);
    expect(loaded).toBeUndefined();
  });

  test("saving twice is idempotent (second load returns same data)", () => {
    const report = captureProvisionError(
      new Error("timeout"),
      { providerName: "railway", stepName: "materialize" },
      cwd,
    );
    const record = buildReplayRecord(report);
    saveReplayRecord(record, cwd);
    saveReplayRecord(record, cwd); // idempotent — writes same file path

    const loaded = loadReplayRecord(report.errorId, cwd);
    expect(loaded!.errorId).toBe(report.errorId);
    expect(loaded!.providerName).toBe("railway");
  });

  test("loadProvisionErrorReport round-trips the full report", () => {
    const err = new Error("403 forbidden");
    const report = captureProvisionError(
      err,
      { providerName: "github", stepName: "provision" },
      cwd,
    );

    const loaded = loadProvisionErrorReport(report.errorId, cwd);
    expect(loaded).toBeDefined();
    expect(loaded!.errorId).toBe(report.errorId);
    expect(loaded!.code).toBe("PERMISSION_DENIED");
    expect(loaded!.providerName).toBe("github");
    expect(loaded!.hints.length).toBeGreaterThan(0);
  });

  test("loadProvisionErrorReport returns undefined for unknown id", () => {
    const loaded = loadProvisionErrorReport("doesnotexist", cwd);
    expect(loaded).toBeUndefined();
  });
});
