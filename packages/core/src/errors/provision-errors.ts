/**
 * Structured error classification for provider provisioning failures.
 *
 * When `provision()` or `materialize()` fails, this module:
 *  1. Maps the raw error to a canonical ProvisionErrorCode.
 *  2. Enriches it with provider context, step info, timing, and sanitized
 *     request/response bodies.
 *  3. Produces a ProvisionErrorReport with actionable recovery hints.
 *  4. Persists the report to `.stack/errors/<timestamp>-<id>.json`.
 *  5. Pretty-prints the report to the CLI with next steps.
 *
 * The `errorId` field (nanoid-style, 12 chars) is stable — it can be
 * passed to `stack replay <error-id>` to re-run the exact failed provider.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ProvisionErrorCode =
  | "AUTH_EXPIRED"
  | "AUTH_MISSING"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "RESOURCE_CONFLICT"
  | "API_DEGRADED"
  | "INVALID_SCHEMA_RESPONSE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "PROVIDER_BUG"
  | "UNKNOWN";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface RecoveryHint {
  /** Short human-readable action description. */
  action: string;
  /**
   * Runnable CLI command the user can copy-paste. May be a `stack` command
   * or an external tool (e.g. `stack open stripe`).
   */
  command: string;
}

export interface RetryPolicy {
  backoffMs: number;
  maxAttempts: number;
}

/** Sanitized snapshot of the HTTP exchange that triggered the error. */
export interface RequestSnapshot {
  method?: string;
  url?: string;
  /** Request body with secret values redacted. */
  body?: unknown;
  statusCode?: number;
  /** Response body with secret values redacted. */
  responseBody?: unknown;
}

/** Full structured error report persisted to `.stack/errors/` and shown in CLI. */
export interface ProvisionErrorReport {
  /** Stable identifier — `stack replay <errorId>` uses this. */
  errorId: string;
  /** ISO 8601 timestamp of when the failure was captured. */
  timestamp: string;

  // Classification
  code: ProvisionErrorCode;
  /** Short human-readable title. */
  title: string;
  /** Detailed explanation of what went wrong. */
  detail: string;

  // Provenance
  providerName: string;
  stepName: string;
  attemptCount: number;
  elapsedMs: number;

  // Request/response snapshot (sanitized)
  request?: RequestSnapshot;

  // Recovery guidance
  hints: RecoveryHint[];
  /** Present when the error is potentially transient and safe to retry. */
  retry?: RetryPolicy;
  /** When true, the user should contact the provider's support. */
  contactSupport?: boolean;

  /** Raw error message before classification. */
  rawError: string;
}

// ---------------------------------------------------------------------------
// Context passed in from pipeline
// ---------------------------------------------------------------------------

export interface ProvisionErrorContext {
  providerName: string;
  stepName: string;
  attemptCount?: number;
  elapsedMs?: number;
  request?: RequestSnapshot;
}

// ---------------------------------------------------------------------------
// Secret-value redaction
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERNS = [
  /key/i,
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /auth/i,
  /credential/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /private/i,
  /bearer/i,
];

/**
 * Recursively walk an object and replace values whose keys look like secrets
 * with `"[REDACTED]"`. Safe to call on request/response bodies before
 * persisting or logging.
 */
export function sanitizeBody(value: unknown, depth = 0): unknown {
  if (depth > 10) return value; // Guard against circular structures
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeBody(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const isSecret = SECRET_KEY_PATTERNS.some((re) => re.test(k));
    out[k] = isSecret ? "[REDACTED]" : sanitizeBody(v, depth + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** Map raw error signals to a canonical ProvisionErrorCode. */
export function classifyError(err: unknown): ProvisionErrorCode {
  const msg = errorMessage(err).toLowerCase();
  const code = (err as { code?: string }).code ?? "";

  // Stack-native codes take priority
  if (code === "PROVISION_TIMEOUT") return "TIMEOUT";
  if (code === "PROVISION_SCHEMA_MISMATCH") return "INVALID_SCHEMA_RESPONSE";

  // HTTP status-code hints embedded in the message
  if (/\b401\b|unauthorized|unauthenticated|auth.*expired|token.*expired/.test(msg))
    return "AUTH_EXPIRED";
  if (/\b403\b|forbidden|permission.*denied|access.*denied/.test(msg)) return "PERMISSION_DENIED";
  if (/\b404\b|not found/.test(msg)) return "NOT_FOUND";
  if (/\b409\b|conflict|already exists/.test(msg)) return "RESOURCE_CONFLICT";
  if (/\b422\b|validation|invalid.*param|unprocessable/.test(msg)) return "VALIDATION_FAILED";
  if (/\b429\b|rate.?limit|too many requests/.test(msg)) return "RATE_LIMITED";
  if (/quota.*exceeded|quota.*limit|usage.*limit|billing|upgrade|plan/.test(msg))
    return "QUOTA_EXCEEDED";
  if (/\b5[0-9]{2}\b|server error|service unavailable|bad gateway|degraded/.test(msg))
    return "API_DEGRADED";
  if (/timeout|timed out|etimedout|deadline/.test(msg)) return "TIMEOUT";
  if (/econnrefused|enotfound|ehostunreach|network|dns/.test(msg)) return "NETWORK_ERROR";
  if (/no.*auth|missing.*key|no.*token|not.*authenticated/.test(msg)) return "AUTH_MISSING";
  if (/malformed|schema|invalid.*response|parse error|json/.test(msg))
    return "INVALID_SCHEMA_RESPONSE";

  return "UNKNOWN";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

// ---------------------------------------------------------------------------
// Hint factory
// ---------------------------------------------------------------------------

const DASHBOARD_COMMANDS: Record<string, string> = {
  supabase: "stack open supabase",
  vercel: "stack open vercel",
  stripe: "stack open stripe",
  neon: "stack open neon",
  railway: "stack open railway",
  render: "stack open render",
  github: "stack open github",
  openai: "stack open openai",
  anthropic: "stack open anthropic",
};

function dashboardCommand(providerName: string): string {
  return DASHBOARD_COMMANDS[providerName.toLowerCase()] ?? `stack open ${providerName}`;
}

/** Build actionable recovery hints for a given error code + provider. */
export function buildHints(
  code: ProvisionErrorCode,
  providerName: string,
): { hints: RecoveryHint[]; retry?: RetryPolicy; contactSupport?: boolean } {
  switch (code) {
    case "AUTH_EXPIRED":
    case "AUTH_MISSING":
      return {
        hints: [
          {
            action: `Re-authenticate with ${providerName} to refresh your credentials`,
            command: `stack login ${providerName}`,
          },
          {
            action: `Then retry provisioning`,
            command: `stack add ${providerName}`,
          },
        ],
      };

    case "QUOTA_EXCEEDED":
      return {
        hints: [
          {
            action: `Check your ${providerName} plan limits and upgrade if needed`,
            command: dashboardCommand(providerName),
          },
          {
            action: `After upgrading, retry provisioning`,
            command: `stack add ${providerName}`,
          },
        ],
        contactSupport: false,
      };

    case "RATE_LIMITED":
      return {
        hints: [
          {
            action: `Wait a moment for the rate limit to reset, then retry`,
            command: `stack add ${providerName}`,
          },
          {
            action: `Check your ${providerName} API usage`,
            command: dashboardCommand(providerName),
          },
        ],
        retry: { backoffMs: 60_000, maxAttempts: 3 },
      };

    case "RESOURCE_CONFLICT":
      return {
        hints: [
          {
            action: `A resource with this name/id may already exist — attach to it instead`,
            command: `stack add ${providerName} --use <existing-resource-id>`,
          },
          {
            action: `Or remove the conflicting resource from the ${providerName} dashboard`,
            command: dashboardCommand(providerName),
          },
          {
            action: `Verify local stack state is consistent`,
            command: `stack doctor`,
          },
        ],
      };

    case "API_DEGRADED":
      return {
        hints: [
          {
            action: `Check ${providerName} status page for ongoing incidents`,
            command: dashboardCommand(providerName),
          },
          {
            action: `Retry once the service recovers`,
            command: `stack add ${providerName}`,
          },
        ],
        retry: { backoffMs: 30_000, maxAttempts: 5 },
        contactSupport: true,
      };

    case "INVALID_SCHEMA_RESPONSE":
      return {
        hints: [
          {
            action: `The ${providerName} API returned an unexpected response shape — this may be a provider SDK bug`,
            command: `stack doctor`,
          },
          {
            action: `File an issue with the error report`,
            command: `stack replay <error-id> --report`,
          },
        ],
        contactSupport: true,
      };

    case "TIMEOUT":
      return {
        hints: [
          {
            action: `Check your network connection and retry`,
            command: `stack add ${providerName}`,
          },
          {
            action: `Increase the per-step timeout if on a slow connection`,
            command: `stack add ${providerName} --timeout 120`,
          },
          {
            action: `Verify no partial resources were created`,
            command: `stack doctor`,
          },
        ],
        retry: { backoffMs: 5_000, maxAttempts: 3 },
      };

    case "NETWORK_ERROR":
      return {
        hints: [
          {
            action: `Check your internet connection and DNS, then retry`,
            command: `stack add ${providerName}`,
          },
        ],
        retry: { backoffMs: 3_000, maxAttempts: 3 },
      };

    case "PERMISSION_DENIED":
      return {
        hints: [
          {
            action: `Ensure your ${providerName} account/token has the required permissions`,
            command: dashboardCommand(providerName),
          },
          {
            action: `Re-authenticate with elevated permissions`,
            command: `stack login ${providerName}`,
          },
        ],
      };

    case "NOT_FOUND":
      return {
        hints: [
          {
            action: `Verify the resource or project exists in ${providerName}`,
            command: dashboardCommand(providerName),
          },
          {
            action: `Run doctor to sync local state`,
            command: `stack doctor`,
          },
        ],
      };

    case "VALIDATION_FAILED":
      return {
        hints: [
          {
            action: `Check the parameters passed to the ${providerName} provider`,
            command: `stack add ${providerName} --help`,
          },
          {
            action: `Inspect the error details above for which field failed`,
            command: `stack doctor`,
          },
        ],
      };

    case "PROVIDER_BUG":
    case "UNKNOWN":
    default:
      return {
        hints: [
          {
            action: `Run the stack doctor to check overall state`,
            command: `stack doctor`,
          },
          {
            action: `Retry provisioning`,
            command: `stack add ${providerName}`,
          },
        ],
        contactSupport: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Titles / detail messages per code
// ---------------------------------------------------------------------------

const CODE_TITLES: Record<ProvisionErrorCode, string> = {
  AUTH_EXPIRED: "Authentication expired",
  AUTH_MISSING: "Authentication missing",
  QUOTA_EXCEEDED: "Quota exceeded",
  RATE_LIMITED: "Rate limited",
  RESOURCE_CONFLICT: "Resource conflict",
  API_DEGRADED: "Provider API degraded",
  INVALID_SCHEMA_RESPONSE: "Invalid schema response",
  TIMEOUT: "Step timed out",
  NETWORK_ERROR: "Network error",
  PERMISSION_DENIED: "Permission denied",
  NOT_FOUND: "Resource not found",
  VALIDATION_FAILED: "Validation failed",
  PROVIDER_BUG: "Provider bug",
  UNKNOWN: "Unknown provisioning failure",
};

function titleForCode(code: ProvisionErrorCode): string {
  return CODE_TITLES[code] ?? "Provisioning failure";
}

// ---------------------------------------------------------------------------
// Unique ID generation (no external deps — crypto.randomUUID stripped)
// ---------------------------------------------------------------------------

function generateErrorId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ---------------------------------------------------------------------------
// Core: capture + classify
// ---------------------------------------------------------------------------

/**
 * Capture a raw provisioning failure, classify it, build recovery hints,
 * persist the report to `.stack/errors/`, and return the structured report.
 *
 * @param err       - The thrown error.
 * @param ctx       - Pipeline context (provider, step, timing, …).
 * @param cwd       - Project root (for `.stack/errors/` path). Defaults to process.cwd().
 */
export function captureProvisionError(
  err: unknown,
  ctx: ProvisionErrorContext,
  cwd: string = process.cwd(),
): ProvisionErrorReport {
  const code = classifyError(err);
  const { hints, retry, contactSupport } = buildHints(code, ctx.providerName);

  const sanitizedRequest = ctx.request
    ? {
        method: ctx.request.method,
        url: ctx.request.url,
        statusCode: ctx.request.statusCode,
        body: ctx.request.body !== undefined ? sanitizeBody(ctx.request.body) : undefined,
        responseBody:
          ctx.request.responseBody !== undefined
            ? sanitizeBody(ctx.request.responseBody)
            : undefined,
      }
    : undefined;

  const report: ProvisionErrorReport = {
    errorId: generateErrorId(),
    timestamp: new Date().toISOString(),
    code,
    title: titleForCode(code),
    detail: errorMessage(err),
    providerName: ctx.providerName,
    stepName: ctx.stepName,
    attemptCount: ctx.attemptCount ?? 1,
    elapsedMs: ctx.elapsedMs ?? 0,
    request: sanitizedRequest,
    hints,
    ...(retry !== undefined && { retry }),
    ...(contactSupport !== undefined && { contactSupport }),
    rawError: errorMessage(err),
  };

  // Persist to .stack/errors/<timestamp>-<id>.json
  try {
    const errDir = join(cwd, ".stack", "errors");
    mkdirSync(errDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = join(errDir, `${ts}-${report.errorId}.json`);
    writeFileSync(filename, JSON.stringify(report, null, 2), "utf-8");
  } catch {
    // Never let persistence failure propagate — the report is still returned.
  }

  return report;
}

// ---------------------------------------------------------------------------
// CLI pretty-printer
// ---------------------------------------------------------------------------

/**
 * Pretty-print a ProvisionErrorReport to the terminal.
 * Uses ANSI escape codes directly to avoid importing the UI layer from core.
 */
export function printProvisionError(report: ProvisionErrorReport): void {
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

  console.error();
  console.error(red(`  ✗ ${bold(report.title)}`));
  console.error(dim(`    Code: ${report.code}  ·  Provider: ${report.providerName}  ·  Step: ${report.stepName}`));
  console.error(dim(`    Error ID: ${report.errorId}  ·  Elapsed: ${report.elapsedMs}ms`));
  console.error();
  console.error(`  ${bold("Detail:")} ${report.detail}`);

  if (report.retry) {
    console.error();
    console.error(
      yellow(
        `  ↻ This error may be transient. Retry policy: backoff ${report.retry.backoffMs}ms × ${report.retry.maxAttempts} attempts.`,
      ),
    );
  }

  if (report.hints.length > 0) {
    console.error();
    console.error(bold("  Recovery steps:"));
    for (const [i, hint] of report.hints.entries()) {
      console.error(`  ${cyan(`${i + 1}.`)} ${hint.action}`);
      console.error(`     ${green(`$ ${hint.command}`)}`);
    }
  }

  if (report.contactSupport) {
    console.error();
    console.error(
      dim(
        `  If the problem persists, contact ${report.providerName} support and reference error ID: ${bold(report.errorId)}`,
      ),
    );
  }

  console.error();
  console.error(dim(`  Report saved: .stack/errors/<timestamp>-${report.errorId}.json`));
  console.error(dim(`  Replay:       stack replay ${report.errorId}`));
  console.error();
}

// ---------------------------------------------------------------------------
// Replay record — persisted alongside the report for `stack replay`
// ---------------------------------------------------------------------------

/**
 * Metadata stored in `.stack/errors/<id>.replay.json` so `stack replay`
 * can reconstruct the exact call without re-parsing the full report.
 */
export interface ReplayRecord {
  errorId: string;
  providerName: string;
  stepName: string;
  timestamp: string;
  /** Whether a fresh auth should be attempted before replay (transient errors). */
  requiresFreshAuth: boolean;
}

const TRANSIENT_CODES: ProvisionErrorCode[] = [
  "TIMEOUT",
  "NETWORK_ERROR",
  "API_DEGRADED",
  "RATE_LIMITED",
];

export function buildReplayRecord(report: ProvisionErrorReport): ReplayRecord {
  return {
    errorId: report.errorId,
    providerName: report.providerName,
    stepName: report.stepName,
    timestamp: report.timestamp,
    requiresFreshAuth: TRANSIENT_CODES.includes(report.code),
  };
}

/**
 * Persist the replay sidecar file next to the main report.
 */
export function saveReplayRecord(
  record: ReplayRecord,
  cwd: string = process.cwd(),
): void {
  try {
    const errDir = join(cwd, ".stack", "errors");
    mkdirSync(errDir, { recursive: true });
    const ts = record.timestamp.replace(/[:.]/g, "-");
    const filename = join(errDir, `${ts}-${record.errorId}.replay.json`);
    writeFileSync(filename, JSON.stringify(record, null, 2), "utf-8");
  } catch {
    /* best-effort */
  }
}

/**
 * Load a ReplayRecord by error-id from `.stack/errors/`.
 * Returns undefined when not found.
 */
export function loadReplayRecord(
  errorId: string,
  cwd: string = process.cwd(),
): ReplayRecord | undefined {
  const { readdirSync, readFileSync: readFS } = require("node:fs") as typeof import("node:fs");
  try {
    const errDir = join(cwd, ".stack", "errors");
    const files = readdirSync(errDir).filter(
      (f: string) => f.endsWith(`.replay.json`) && f.includes(errorId),
    );
    if (files.length === 0) return undefined;
    const raw = readFS(join(errDir, files[0]!), "utf-8");
    return JSON.parse(raw) as ReplayRecord;
  } catch {
    return undefined;
  }
}

/**
 * Load a ProvisionErrorReport by error-id from `.stack/errors/`.
 * Returns undefined when not found.
 */
export function loadProvisionErrorReport(
  errorId: string,
  cwd: string = process.cwd(),
): ProvisionErrorReport | undefined {
  const { readdirSync, readFileSync: readFS } = require("node:fs") as typeof import("node:fs");
  try {
    const errDir = join(cwd, ".stack", "errors");
    const files = readdirSync(errDir).filter(
      (f: string) => f.endsWith(".json") && !f.endsWith(".replay.json") && f.includes(errorId),
    );
    if (files.length === 0) return undefined;
    const raw = readFS(join(errDir, files[0]!), "utf-8");
    return JSON.parse(raw) as ProvisionErrorReport;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Provision Replay Log — crash-recovery harness
// ---------------------------------------------------------------------------

/**
 * Status of a single provision replay log entry.
 *
 * - "completed"  : step finished successfully; safe to skip on replay.
 * - "failed"     : step threw; replay should attempt from this step.
 * - "partial"    : step started writing state before a crash (e.g. secrets
 *                  written, then process killed before MCP merge). Replay
 *                  must handle partial writes carefully.
 * - "in_progress": step was running when the process crashed (no explicit
 *                  failure recorded). Replay must assume ambiguous upstream
 *                  state and either re-attach or deprovision+retry.
 */
export type ReplayLogStatus = "completed" | "failed" | "partial" | "in_progress";

/**
 * A single step entry written to the JSONL replay log.
 *
 * One line per step; the file is `~/.stack/.replay-logs/<sessionId>.jsonl`.
 * Each line is a self-contained JSON object so the log is readable even if
 * the process was killed mid-write.
 */
export interface ProvisionReplayLog {
  /** ISO 8601 wall-clock timestamp. */
  timestamp: string;
  /** Step label: "login" | "provision" | "materialize" | "secrets" | "mcp" | "config" */
  stepName: string;
  /** Provider identifier. */
  providerName: string;
  /** Sanitized inputs passed to the step (no secret values). */
  input: Record<string, unknown>;
  /** Sanitized outputs from the step (no secret values). */
  output: Record<string, unknown>;
  /** Step outcome. */
  status: ReplayLogStatus;
  /** Error message when status is "failed" or "partial". */
  error?: string;
  /**
   * When status is "partial", lists exactly which sub-items were written
   * so the recovery function can skip or re-attempt them individually.
   */
  partialItems?: Array<{ kind: "secret" | "mcp_entry" | "config_entry"; id: string }>;
}

/**
 * Session-level metadata prepended as the first line of the JSONL log.
 * Allows `stack resume` to list sessions without parsing every entry.
 */
export interface ReplaySessionMeta {
  sessionId: string;
  providerName: string;
  cwd: string;
  startedAt: string;
  /** Populated when the session ends (success or failure). */
  finishedAt?: string;
  finalStatus?: "success" | "failed" | "partial_crash";
}

/**
 * Resolve the directory that holds replay logs.
 * Uses `STACK_REPLAY_LOG_DIR` env override for tests; otherwise `~/.stack/.replay-logs`.
 */
export function replayLogDir(): string {
  if (process.env.STACK_REPLAY_LOG_DIR) return process.env.STACK_REPLAY_LOG_DIR;
  const { homedir } = require("node:os") as typeof import("node:os");
  return join(homedir(), ".stack", ".replay-logs");
}

/**
 * Persist a single {@link ProvisionReplayLog} entry to the session JSONL file.
 * Always appends; never rewrites. Best-effort: errors are swallowed.
 */
export function appendReplayLog(sessionId: string, entry: ProvisionReplayLog): void {
  try {
    const dir = replayLogDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${sessionId}.jsonl`);
    writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: "a", encoding: "utf-8" });
  } catch {
    /* best-effort — never block the pipeline */
  }
}

/**
 * Write or overwrite the session-level metadata line.
 * The meta is stored as `<sessionId>.meta.json` alongside the JSONL log.
 */
export function writeReplaySessionMeta(meta: ReplaySessionMeta): void {
  try {
    const dir = replayLogDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${meta.sessionId}.meta.json`);
    writeFileSync(path, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    /* best-effort */
  }
}

/**
 * Read the session-level metadata for a given sessionId.
 * Returns undefined when not found.
 */
export function readReplaySessionMeta(sessionId: string): ReplaySessionMeta | undefined {
  const { readFileSync: readFS } = require("node:fs") as typeof import("node:fs");
  try {
    const path = join(replayLogDir(), `${sessionId}.meta.json`);
    return JSON.parse(readFS(path, "utf-8")) as ReplaySessionMeta;
  } catch {
    return undefined;
  }
}

/**
 * Read all {@link ProvisionReplayLog} entries for a session.
 * Returns an empty array when the log file is not found or is unreadable.
 */
export function readReplayLog(sessionId: string): ProvisionReplayLog[] {
  const { readFileSync: readFS } = require("node:fs") as typeof import("node:fs");
  try {
    const path = join(replayLogDir(), `${sessionId}.jsonl`);
    const text = readFS(path, "utf-8") as string;
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as ProvisionReplayLog;
        } catch {
          return null;
        }
      })
      .filter((e): e is ProvisionReplayLog => e !== null);
  } catch {
    return [];
  }
}

/**
 * List all known replay sessions, sorted newest-first.
 * Returns only sessions whose meta file exists.
 */
export function listReplaySessions(): ReplaySessionMeta[] {
  const { readdirSync, readFileSync: readFS } = require("node:fs") as typeof import("node:fs");
  try {
    const dir = replayLogDir();
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".meta.json"));
    const sessions: ReplaySessionMeta[] = [];
    for (const file of files) {
      try {
        const raw = readFS(join(dir, file), "utf-8") as string;
        sessions.push(JSON.parse(raw) as ReplaySessionMeta);
      } catch {
        /* skip unreadable */
      }
    }
    // Newest first
    sessions.sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Generate a session ID for a new provision run.
 * Format: `<timestamp-ms>-<providerName>-<random6>` — human-readable in ls output.
 */
export function generateSessionId(providerName: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${providerName}-${rand}`;
}
