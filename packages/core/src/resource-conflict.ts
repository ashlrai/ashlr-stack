/**
 * Resource Conflict Detection & Auto-Recovery
 *
 * Runs before `provision()` to detect whether a requested resource name, org,
 * or database already exists on the provider side and offers three outcomes:
 *
 *   1. attach  — attach to the existing resource with user confirmation
 *   2. rename  — auto-generate a unique name and retry
 *   3. fail    — surface explicit guidance and stop
 *
 * Wires `[services.SERVICE_NAME.meta.conflictCheck]` into `.stack.toml` (the
 * instance/local fragment) after each check so tooling and `stack doctor` can
 * audit what happened.
 *
 * Telemetry: emits a `conflict_check` event field on every run so collision
 * rates can be tracked per-provider. Follows the privacy contract in
 * telemetry.ts — no project names, resource IDs, or secret values are sent.
 */

import type { AuthHandle, ConflictCheckOpts, ResourceConflictCheckConfig } from "./providers/_base.ts";
import type { Provider } from "./providers/_base.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** How the caller wants to resolve a detected conflict. */
export type ConflictResolutionStrategy =
  | "attach"   // reuse the existing resource (user confirmed or auto in CI)
  | "rename"   // auto-generate a unique name and retry
  | "fail";    // surface the error and stop

/**
 * Options passed by the pipeline into `runConflictCheck()`.
 */
export interface ConflictCheckRunOpts {
  /** The provider performing the check. */
  provider: Provider;
  /** Auth handle used to call the provider's list endpoint. */
  auth: AuthHandle;
  /** Desired resource name (may be absent if auto-naming). */
  desiredName?: string;
  /** Provider hints forwarded from CLI (e.g. orgId, region). */
  hints?: Record<string, unknown>;
  /** AbortSignal from the pipeline timeout. */
  signal?: AbortSignal;
  /**
   * Interactive mode: when true, the pipeline may prompt the user to choose
   * a resolution strategy. When false (CI/agent), the `ciStrategy` is used
   * automatically.
   */
  interactive: boolean;
  /**
   * Resolution strategy used in non-interactive (CI) mode when a conflict is
   * detected. Defaults to "rename" — the safest non-destructive auto-recovery.
   */
  ciStrategy?: ConflictResolutionStrategy;
  /**
   * Whether conflict checking is enabled at all.
   *   true  — always check (default in interactive mode)
   *   false — skip checking (default in CI / dry-run)
   * When `false`, returns an "skipped" result immediately.
   */
  enabled?: boolean;
  /**
   * Optional prompt function injected by the CLI so the core package stays
   * dependency-free. When provided and `interactive` is true, it is called
   * with the conflict result and must return the chosen strategy.
   */
  prompt?: ConflictPromptFn;
}

/**
 * Function signature for the interactive conflict resolution prompt.
 * Implemented in the CLI layer (e.g. using @clack/prompts).
 */
export type ConflictPromptFn = (
  result: ResourceConflictCheckConfig,
  providerDisplayName: string,
) => Promise<ConflictResolutionStrategy>;

/**
 * Output of `runConflictCheck()`.
 */
export interface ConflictCheckResult {
  /** The raw check result from the provider. */
  check: ResourceConflictCheckConfig;
  /**
   * The resolved strategy — what the pipeline should do next.
   * "ok" / "skipped" / "unreachable" mean proceed with the original intent.
   * "attach" means pass `existingResourceId` to `provision()`.
   * "rename" means pass `suggestedUniqueName` as the desired name.
   * "fail" means throw and stop.
   */
  resolvedStrategy: ConflictResolutionStrategy | "ok" | "skipped" | "unreachable";
  /**
   * The resource ID to pass as `existingResourceId` when strategy is "attach".
   */
  attachResourceId?: string;
  /**
   * The unique name to use when strategy is "rename".
   */
  uniqueName?: string;
}

/**
 * Telemetry field emitted after every conflict check.
 * Privacy contract: no project names, resource IDs, or secret values.
 */
export interface ConflictCheckTelemetry {
  /** Provider name (e.g. "neon"). */
  provider: string;
  /** Whether a collision was detected. */
  collisionDetected: boolean;
  /** The resolved strategy. */
  strategy: string;
  /** Whether the check was skipped or provider was unreachable. */
  skipped: boolean;
  /** ISO timestamp. */
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Run a pre-provision conflict check for `opts.provider`.
 *
 * Guarantees:
 *   - A provider that doesn't implement `checkConflict()` returns "skipped".
 *   - A provider that throws / returns unreachable does NOT block provisioning.
 *   - In CI (interactive=false) the `ciStrategy` resolves automatically.
 *   - When `enabled` is false, returns immediately with action "skipped".
 */
export async function runConflictCheck(opts: ConflictCheckRunOpts): Promise<ConflictCheckResult> {
  const now = new Date().toISOString();

  // Fast path: disabled (CI without flag, dry-run, etc.)
  if (opts.enabled === false) {
    const skipped: ResourceConflictCheckConfig = {
      requestedName: opts.desiredName ?? "(auto)",
      exists: undefined,
      action: "skipped",
      message: "Conflict checking is disabled for this invocation.",
      checkedAt: now,
    };
    return { check: skipped, resolvedStrategy: "skipped" };
  }

  // Fast path: provider doesn't implement checkConflict
  if (!opts.provider.checkConflict) {
    const skipped: ResourceConflictCheckConfig = {
      requestedName: opts.desiredName ?? "(auto)",
      exists: undefined,
      action: "skipped",
      message: `Provider "${opts.provider.name}" does not implement conflict checking.`,
      checkedAt: now,
    };
    return { check: skipped, resolvedStrategy: "skipped" };
  }

  // Run the provider's check — must not throw (unreachable → non-blocking)
  let check: ResourceConflictCheckConfig;
  try {
    const checkOpts: ConflictCheckOpts = {
      desiredName: opts.desiredName,
      hints: opts.hints,
      signal: opts.signal,
    };
    check = await opts.provider.checkConflict(opts.auth, checkOpts);
  } catch {
    // Provider check threw — treat as unreachable, never block provision
    check = {
      requestedName: opts.desiredName ?? "(auto)",
      exists: undefined,
      action: "unreachable",
      message: `Conflict check for "${opts.provider.name}" failed (provider unreachable). Proceeding with provision.`,
      checkedAt: now,
    };
    return { check, resolvedStrategy: "unreachable" };
  }

  // Provider unreachable / skipped — never block (check action BEFORE exists)
  if (check.action === "unreachable" || check.action === "skipped") {
    return { check, resolvedStrategy: check.action };
  }

  // No conflict
  if (!check.exists || check.action === "ok") {
    return { check: { ...check, action: "ok" }, resolvedStrategy: "ok" };
  }

  // Conflict detected — resolve strategy
  const ciStrategy: ConflictResolutionStrategy = opts.ciStrategy ?? "rename";

  let strategy: ConflictResolutionStrategy;

  if (opts.interactive && opts.prompt) {
    // Delegate to CLI prompt
    strategy = await opts.prompt(check, opts.provider.displayName);
  } else {
    // Non-interactive: use CI strategy
    strategy = ciStrategy;
  }

  if (strategy === "fail") {
    return {
      check: { ...check, action: "fail" },
      resolvedStrategy: "fail",
    };
  }

  if (strategy === "attach") {
    return {
      check: { ...check, action: "attach" },
      resolvedStrategy: "attach",
      attachResourceId: check.existingResourceId,
    };
  }

  // strategy === "rename"
  const uniqueName = check.suggestedUniqueName ?? generateUniqueName(check.requestedName);
  return {
    check: { ...check, action: "rename" },
    resolvedStrategy: "rename",
    uniqueName,
  };
}

/**
 * Build the meta block stored under
 * `[services.SERVICE_NAME.meta.conflictCheck]` in `.stack.local.toml`.
 */
export function buildConflictCheckMeta(
  result: ConflictCheckResult,
  originalName: string,
): Record<string, unknown> {
  return {
    checkedAt: result.check.checkedAt,
    originalNameAttempted: originalName,
    action: result.resolvedStrategy,
    collisionDetected: result.check.exists === true,
    ...(result.attachResourceId ? { attachedResourceId: result.attachResourceId } : {}),
    ...(result.uniqueName ? { renamedTo: result.uniqueName } : {}),
  };
}

/**
 * Build a `ConflictCheckTelemetry` payload (no PII — follows telemetry.ts contract).
 */
export function buildConflictCheckTelemetry(
  providerName: string,
  result: ConflictCheckResult,
): ConflictCheckTelemetry {
  return {
    provider: providerName,
    collisionDetected: result.check.exists === true,
    strategy: result.resolvedStrategy,
    skipped: result.resolvedStrategy === "skipped" || result.resolvedStrategy === "unreachable",
    checkedAt: result.check.checkedAt,
  };
}

/**
 * Generate a unique name by appending a base-36 timestamp suffix.
 * Mirrors the auto-naming pattern used by all providers in `provision()`.
 */
export function generateUniqueName(base: string): string {
  const suffix = Date.now().toString(36);
  // Truncate base so total length stays reasonable (max 40 chars)
  const maxBase = 32;
  const trimmed = base.length > maxBase ? base.slice(0, maxBase) : base;
  return `${trimmed}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Default no-prompt fallback (used when interactive=true but no prompt fn)
// ---------------------------------------------------------------------------

/**
 * Default CI/fallback prompt: always returns the ciStrategy without I/O.
 * The CLI layer should inject a real @clack/prompts-backed prompt instead.
 */
export function defaultCiPrompt(ciStrategy: ConflictResolutionStrategy): ConflictPromptFn {
  return async (_result, _displayName) => ciStrategy;
}
