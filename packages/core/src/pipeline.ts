import { type ServiceEntry, type StackConfig, readConfig, writeConfig } from "./config.ts";
import { type DryRunAddServiceOpts, dryRunAddService } from "./dry-run.ts";
import { StackError } from "./errors.ts";
import {
  buildConflictCheckMeta,
  buildConflictCheckTelemetry,
  runConflictCheck,
  type ConflictCheckRunOpts,
  type ConflictPromptFn,
} from "./resource-conflict.ts";
import {
  appendReplayLog,
  buildReplayRecord,
  captureProvisionError,
  generateSessionId,
  readReplayLog,
  readReplaySessionMeta,
  saveReplayRecord,
  writeReplaySessionMeta,
  type ProvisionReplayLog,
  type ReplaySessionMeta,
} from "./errors/provision-errors.ts";
import { instrumentation } from "./instrumentation.ts";
import type { RollbackItem } from "./instrumentation.ts";
import { mergeMcpEntry, removeMcpEntry } from "./mcp-writer.ts";
import { addSecret, assertPhantomInstalled, removeSecret } from "./phantom.ts";
import type { AuthHandle, LogEvent, ProviderContext, Resource } from "./providers/_base.ts";
import { getProvider } from "./providers/index.ts";
import {
  ProvisionSchemaValidationError,
  validateProvisionResponse,
} from "./provision-schema.ts";
import { enforcePostCompliance, enforcePreCompliance } from "./provision-compliance.ts";
import { enforceReadiness } from "./provision-readiness.ts";

/** Default wall-clock timeout for each provider step (login / provision / materialize). */
const DEFAULT_STEP_TIMEOUT_MS = 30_000;

/**
 * Race a promise against a wall-clock timeout driven by an AbortController.
 * If the timeout fires first, the controller is aborted (so providers that
 * accept a signal can observe it) and a StackError with code PROVISION_TIMEOUT
 * is thrown. The promise itself is NOT cancelled — JS has no cooperative
 * cancellation — but the pipeline stops waiting for it.
 */
async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  controller: AbortController,
  fn: () => Promise<T>,
): Promise<T> {
  // Infinity means disabled — run the fn directly with no race.
  if (!isFinite(timeoutMs)) {
    return fn();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new StackError(
          "PROVISION_TIMEOUT",
          `Provider step "${label}" did not complete within ${timeoutMs / 1000}s. ` +
            `The pipeline has been aborted. Check your network / API status and retry.`,
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AddServiceOpts {
  providerName: string;
  cwd?: string;
  interactive?: boolean;
  existingResourceId?: string;
  hints?: Record<string, unknown>;
  log?: (event: LogEvent) => void;
  /** If false, skip persisting to .stack.toml (used by dry-run / preview). */
  persist?: boolean;
  /**
   * Wall-clock timeout in milliseconds applied to each provider step
   * (login, provision, materialize) independently. Defaults to 30 000 ms.
   * Set to 0 to disable (not recommended in production).
   */
  timeoutMs?: number;
  /**
   * When true, skip all upstream API calls, secret writes, MCP edits, and
   * config writes. Returns a synthetic but realistic result from the dry-run
   * engine instead. No Phantom installation required.
   */
  dryRun?: boolean;
  /**
   * When true (and dryRun is also true), attach a cost estimate to the result
   * from the static cost registry (Moat 2 groundwork — will be replaced by
   * live provider MCP calls in a future release).
   */
  costEstimate?: boolean;
  /**
   * Session ID for the crash-recovery replay log. When provided, the pipeline
   * will append JSONL entries to `~/.stack/.replay-logs/<sessionId>.jsonl` at
   * every step boundary so that `stack resume <sessionId>` can skip completed
   * steps after a crash. When omitted, a new session ID is generated automatically.
   * Set to `false` to disable replay logging entirely (e.g. dry-run).
   */
  sessionId?: string | false;
  /**
   * Whether to run pre-provision resource conflict detection.
   *   true  — always check (default in interactive mode)
   *   false — skip entirely (default in CI / dry-run)
   * When omitted, defaults to `true` in interactive mode and `false` in CI.
   */
  checkConflicts?: boolean;
  /**
   * Resolution strategy for non-interactive (CI) conflict resolution.
   *   "attach" — reuse existing resource automatically
   *   "rename" — auto-generate a unique name (default)
   *   "fail"   — stop and surface an error
   */
  ciConflictStrategy?: "attach" | "rename" | "fail";
  /**
   * Optional interactive prompt function injected by the CLI for conflict
   * resolution. When provided and interactive mode is active, it will be
   * called when a conflict is detected. Must return the chosen strategy.
   */
  conflictPrompt?: ConflictPromptFn;
}

export interface AddServiceResult {
  providerName: string;
  resourceId: string;
  displayName: string;
  secretCount: number;
  mcpWired: boolean;
  entry: ServiceEntry;
  /** Present only when the call was made with dryRun: true */
  dryRun?: true;
}

/**
 * Full add-service pipeline: login → provision → materialize → write secrets
 * → merge .mcp.json → update .stack.toml. Used by both `stack add` and
 * `stack templates apply` so behaviour stays in lockstep.
 *
 * When `opts.dryRun` is true the function short-circuits into the dry-run
 * engine: no upstream API calls, no Phantom writes, no MCP or config changes.
 * Returns a result whose shape is compatible with the real path so callers
 * can render it uniformly.
 */
export async function addService(opts: AddServiceOpts): Promise<AddServiceResult> {
  // --- Dry-run short-circuit ---
  if (opts.dryRun) {
    const dryOpts: DryRunAddServiceOpts = {
      providerName: opts.providerName,
      existingResourceId: opts.existingResourceId,
      hints: opts.hints,
      costEstimate: opts.costEstimate,
    };
    const dryResult = await dryRunAddService(dryOpts);
    // Return a shape that satisfies AddServiceResult — entry is synthesised so
    // callers that only inspect providerName/resourceId/displayName/counts work.
    return {
      providerName: dryResult.providerName,
      resourceId: dryResult.resourceId,
      displayName: dryResult.displayName,
      secretCount: dryResult.secretCount,
      mcpWired: dryResult.mcpWired,
      dryRun: true,
      entry: {
        provider: dryResult.providerName,
        resource_id: dryResult.resourceId,
        secrets: Object.keys(dryResult.report.secrets),
        mcp: dryResult.report.mcpEntry?.name,
        meta: dryResult.report.resource.meta,
        created_at: new Date().toISOString(),
        created_by: "stack add --dry-run",
      },
    };
  }

  await assertPhantomInstalled();
  const provider = await getProvider(opts.providerName);
  const cwd = opts.cwd ?? process.cwd();
  const config: StackConfig = await readConfig(cwd);

  // Attaching to an existing resource id is always allowed — that's the path
  // `stack doctor --fix` uses to re-run the pipeline for a degraded service.
  if (config.services[provider.name] && !opts.existingResourceId) {
    throw new StackError(
      "SERVICE_ALREADY_ADDED",
      `${provider.displayName} is already in this stack. Pass existingResourceId to re-attach, or remove it first.`,
    );
  }

  const timeoutMs =
    opts.timeoutMs === 0 ? Number.POSITIVE_INFINITY : (opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);

  // One AbortController per pipeline run — aborted on any step timeout so that
  // providers accepting a signal (future-proof) can self-cancel.
  const controller = new AbortController();

  const ctx: ProviderContext = {
    cwd,
    interactive: opts.interactive ?? process.stdout.isTTY === true,
    log: opts.log ?? (() => {}),
    hints: opts.hints,
    signal: controller.signal,
  };

  // --- Replay log session setup ---
  // sessionId === false means caller explicitly opted out (dry-run etc.).
  // sessionId === undefined means auto-generate a new one.
  const sessionId: string | false =
    opts.sessionId === false ? false : (opts.sessionId ?? generateSessionId(provider.name));

  if (sessionId !== false) {
    const meta: ReplaySessionMeta = {
      sessionId,
      providerName: provider.name,
      cwd,
      startedAt: new Date().toISOString(),
      finalStatus: undefined,
    };
    writeReplaySessionMeta(meta);
  }

  /** Append a replay log entry when replay logging is active. */
  function emitReplayLog(entry: ProvisionReplayLog): void {
    if (sessionId !== false) appendReplayLog(sessionId, entry);
  }

  /** Finalise the session meta with a terminal status. */
  function finaliseSession(status: ReplaySessionMeta["finalStatus"]): void {
    if (sessionId === false) return;
    const meta = readReplaySessionMeta(sessionId);
    if (meta) {
      writeReplaySessionMeta({ ...meta, finishedAt: new Date().toISOString(), finalStatus: status });
    }
  }

  // --- login ---
  let auth: AuthHandle;
  try {
    const _t0 = Date.now();
    // Mark the step as in_progress before we start so a crash mid-step is detectable.
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "login",
      providerName: provider.name,
      input: {},
      output: {},
      status: "in_progress",
    });
    auth = await withTimeout("login", timeoutMs, controller, () => provider.login(ctx));
    instrumentation.recordStep("login", provider.name, Date.now() - _t0, "success");
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "login",
      providerName: provider.name,
      input: {},
      output: { identity: (auth as { identity?: unknown }).identity ?? null },
      status: "completed",
    });
  } catch (err) {
    // login timed out or failed — no upstream resource was created, nothing to roll back.
    const code = err instanceof StackError ? err.code : undefined;
    const status = code === "PROVISION_TIMEOUT" ? "timeout" : "failure";
    instrumentation.recordStep("login", provider.name, 0, status, (err as Error).message, code);
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "login",
      providerName: provider.name,
      input: {},
      output: {},
      status: "failed",
      error: (err as Error).message,
    });
    finaliseSession("failed");
    const report = captureProvisionError(err, {
      providerName: provider.name,
      stepName: "login",
      attemptCount: 1,
      elapsedMs: 0,
    }, cwd);
    saveReplayRecord(buildReplayRecord(report), cwd);
    throw err;
  }

  // --- pre-provision compliance checks ---
  // Run before any upstream resource is created so failures are free to abort.
  try {
    enforcePreCompliance({
      provider: provider.name,
      hints: opts.hints,
      log: (level, msg) => ctx.log({ level, msg }),
    });
  } catch (err) {
    finaliseSession("failed");
    throw err;
  }

  // --- provider readiness gate ---
  // Run after auth but before any upstream resource is created.  Checks
  // billing state, quota headroom, org existence, API limits, etc. so that
  // failures surface with actionable remediation rather than mysterious
  // post-provision errors.
  try {
    enforceReadiness({
      provider: provider.name,
      hints: opts.hints,
      log: (level, msg) => ctx.log({ level, msg }),
    });
  } catch (err) {
    finaliseSession("failed");
    throw err;
  }

  // --- conflict check (pre-provision) ---
  // Determine whether checks are enabled.
  // Default: enabled in interactive mode, disabled in CI.
  const conflictCheckEnabled =
    opts.checkConflicts !== undefined
      ? opts.checkConflicts
      : (opts.interactive ?? process.stdout.isTTY === true);

  // Only run when not using an existingResourceId (that path is an explicit attach).
  let resolvedExistingResourceId = opts.existingResourceId;
  let resolvedHints = opts.hints;
  if (!opts.existingResourceId && !opts.dryRun) {
    const conflictOpts: ConflictCheckRunOpts = {
      provider,
      auth,
      desiredName: (opts.hints?.name as string | undefined),
      hints: opts.hints,
      signal: controller.signal,
      interactive: opts.interactive ?? process.stdout.isTTY === true,
      ciStrategy: opts.ciConflictStrategy ?? "rename",
      enabled: conflictCheckEnabled,
      prompt: opts.conflictPrompt,
    };
    const conflictResult = await runConflictCheck(conflictOpts);
    // Track telemetry (fire-and-forget, non-blocking)
    const conflictTelemetry = buildConflictCheckTelemetry(provider.name, conflictResult);
    void conflictTelemetry; // available for future telemetry.emit() integration

    if (conflictResult.resolvedStrategy === "fail") {
      throw new StackError(
        "RESOURCE_CONFLICT",
        `Resource conflict detected for ${provider.displayName}: ${conflictResult.check.message} ` +
          `Pass --use <id> to attach to the existing resource, or choose a different name.`,
      );
    }
    if (conflictResult.resolvedStrategy === "attach" && conflictResult.attachResourceId) {
      resolvedExistingResourceId = conflictResult.attachResourceId;
    }
    if (conflictResult.resolvedStrategy === "rename" && conflictResult.uniqueName) {
      resolvedHints = { ...(opts.hints ?? {}), name: conflictResult.uniqueName };
    }

    // Persist conflict check metadata to the service entry meta (wired into
    // .stack.local.toml under [services.SERVICE_NAME.meta.conflictCheck]).
    // We stash it on ctx.hints so it flows through to the entry builder below.
    if (conflictResult.check.action !== "skipped") {
      const conflictMeta = buildConflictCheckMeta(
        conflictResult,
        conflictResult.check.requestedName,
      );
      resolvedHints = { ...(resolvedHints ?? {}), _conflictCheckMeta: conflictMeta };
    }
  }

  // --- provision ---
  let resource: Resource;
  try {
    const _t0 = Date.now();
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "provision",
      providerName: provider.name,
      input: {
        existingResourceId: resolvedExistingResourceId ?? null,
        hints: resolvedHints ?? null,
      },
      output: {},
      status: "in_progress",
    });
    resource = await withTimeout("provision", timeoutMs, controller, () =>
      provider.provision(ctx, auth, {
        existingResourceId: resolvedExistingResourceId,
        hints: resolvedHints,
      }),
    );
    instrumentation.recordStep("provision", provider.name, Date.now() - _t0, "success");
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "provision",
      providerName: provider.name,
      input: {
        existingResourceId: resolvedExistingResourceId ?? null,
        hints: resolvedHints ?? null,
      },
      output: { resourceId: resource.id, displayName: resource.displayName, region: resource.region ?? null },
      status: "completed",
    });
  } catch (err) {
    // provision timed out or failed before an upstream resource was confirmed —
    // if it's a timeout and the provider has deprovision, attempt best-effort rollback.
    const code = err instanceof StackError ? err.code : undefined;
    const status = code === "PROVISION_TIMEOUT" ? "timeout" : "failure";
    instrumentation.recordStep("provision", provider.name, 0, status, (err as Error).message, code);
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "provision",
      providerName: provider.name,
      input: { existingResourceId: resolvedExistingResourceId ?? null },
      output: {},
      status: "failed",
      error: (err as Error).message,
    });
    finaliseSession("failed");
    const provisionReport = captureProvisionError(err, {
      providerName: provider.name,
      stepName: "provision",
      attemptCount: 1,
      elapsedMs: 0,
    }, cwd);
    saveReplayRecord(buildReplayRecord(provisionReport), cwd);
    if (
      err instanceof StackError &&
      err.code === "PROVISION_TIMEOUT" &&
      provider.deprovision &&
      resolvedExistingResourceId
    ) {
      try {
        await provider.deprovision(ctx, auth, resolvedExistingResourceId);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }

  // --- Schema validation (M: Provision Response Schema Validation Enforcement) ---
  // Validate the raw resource returned by provider.provision() against the
  // registered JSON Schema for this provider. Catches malformed API responses
  // before they propagate into materialize() or .stack.toml.
  try {
    const validated = validateProvisionResponse(provider.name, resource);
    // Merge validated fields back into resource (coerced id/displayName/region/meta)
    resource = validated;
  } catch (err) {
    if (err instanceof ProvisionSchemaValidationError) {
      // Attempt best-effort deprovision since the resource was already created
      if (provider.deprovision) {
        try {
          await provider.deprovision(ctx, auth, resource.id);
        } catch {
          /* best-effort */
        }
      }
      throw new StackError(
        "PROVISION_SCHEMA_MISMATCH",
        `Provider "${provider.name}" returned a malformed provision response: ${err.message}`,
        { cause: err },
      );
    }
    throw err;
  }

  // --- Post-provision compliance checks ---
  // Run after schema validation but before materialize(). Failures trigger
  // best-effort deprovision so the upstream resource is cleaned up automatically.
  try {
    await enforcePostCompliance({
      provider: provider.name,
      resource,
      hints: resolvedHints,
      log: (level, msg) => ctx.log({ level, msg }),
      deprovision: provider.deprovision
        ? () => provider.deprovision!(ctx, auth, resource.id)
        : undefined,
    });
  } catch (err) {
    finaliseSession("failed");
    throw err;
  }

  // Provision succeeded: from here on, any failure must roll back atomically.
  // Track what has been written so the catch block can undo exactly that.
  const writtenSecrets: string[] = [];
  let writtenMcp: string | undefined;

  try {
    const _t0 = Date.now();
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "materialize",
      providerName: provider.name,
      input: { resourceId: resource.id },
      output: {},
      status: "in_progress",
    });
    const materialized = await withTimeout("materialize", timeoutMs, controller, () =>
      provider.materialize(ctx, resource, auth),
    );
    instrumentation.recordStep("materialize", provider.name, Date.now() - _t0, "success");
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "materialize",
      providerName: provider.name,
      input: { resourceId: resource.id },
      // Never log secret values — only key names.
      output: { secretKeys: Object.keys(materialized.secrets), mcpName: materialized.mcp?.name ?? null },
      status: "completed",
    });

    // --- secrets ---
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "secrets",
      providerName: provider.name,
      input: { secretKeys: Object.keys(materialized.secrets) },
      output: {},
      status: "in_progress",
    });
    for (const [key, value] of Object.entries(materialized.secrets)) {
      await addSecret(key, value, cwd);
      writtenSecrets.push(key);
    }
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: "secrets",
      providerName: provider.name,
      input: { secretKeys: Object.keys(materialized.secrets) },
      output: { writtenKeys: writtenSecrets.slice() },
      status: "completed",
    });

    if (materialized.mcp) {
      await mergeMcpEntry(materialized.mcp, cwd);
      writtenMcp = materialized.mcp.name;
    }

    // Merge conflict check metadata into the service entry meta so it is
    // persisted into .stack.local.toml under [services.NAME.meta.conflictCheck].
    const conflictCheckMeta = resolvedHints?._conflictCheckMeta as Record<string, unknown> | undefined;
    const entryMeta: Record<string, unknown> | undefined =
      conflictCheckMeta
        ? { ...(resource.meta ?? {}), conflictCheck: conflictCheckMeta }
        : resource.meta;

    const entry: ServiceEntry = {
      provider: provider.name,
      resource_id: resource.id,
      region: resource.region,
      secrets: Object.keys(materialized.secrets),
      mcp: materialized.mcp?.name,
      meta: entryMeta,
      created_at: new Date().toISOString(),
      created_by: "stack add",
    };

    if (opts.persist !== false) {
      config.services[provider.name] = entry;
      await writeConfig(config, cwd);
    }

    finaliseSession("success");

    return {
      providerName: provider.name,
      resourceId: resource.id,
      displayName: resource.displayName,
      secretCount: Object.keys(materialized.secrets).length,
      mcpWired: Boolean(materialized.mcp),
      entry,
    };
  } catch (err) {
    // Record materialize failure before starting rollback.
    const errCode = err instanceof StackError ? err.code : undefined;
    const errStatus = errCode === "PROVISION_TIMEOUT" ? "timeout" : "failure";
    const failStep = writtenSecrets.length > 0 ? "MCP/config write" : "materialize";
    instrumentation.recordStep(
      "materialize",
      provider.name,
      0,
      errStatus,
      (err as Error).message,
      errCode,
    );

    // Distinguish 'partial state written before crash' from 'stepwise rollback on error'.
    // If some secrets were already written when the error occurred, this is a partial-state
    // crash scenario; otherwise it is a clean stepwise rollback.
    const isPartialCrash = writtenSecrets.length > 0 || writtenMcp !== undefined;
    emitReplayLog({
      timestamp: new Date().toISOString(),
      stepName: failStep,
      providerName: provider.name,
      input: { resourceId: resource.id },
      output: {},
      status: isPartialCrash ? "partial" : "failed",
      error: (err as Error).message,
      ...(isPartialCrash
        ? {
            partialItems: [
              ...writtenSecrets.map((k) => ({ kind: "secret" as const, id: k })),
              ...(writtenMcp ? [{ kind: "mcp_entry" as const, id: writtenMcp }] : []),
            ],
          }
        : {}),
    });
    finaliseSession(isPartialCrash ? "partial_crash" : "failed");

    const materializeReport = captureProvisionError(err, {
      providerName: provider.name,
      stepName: failStep,
      attemptCount: 1,
      elapsedMs: 0,
    }, cwd);
    saveReplayRecord(buildReplayRecord(materializeReport), cwd);

    // --- Atomic rollback ---
    // 1. Remove any Phantom secrets already written.
    const cleanedItems: RollbackItem[] = [];
    const failedItems: RollbackItem[] = [];

    for (const key of writtenSecrets) {
      try {
        await removeSecret(key, cwd);
        cleanedItems.push({ kind: "secret", id: key });
      } catch (rerr) {
        failedItems.push({ kind: "secret", id: key, error: (rerr as Error).message });
      }
    }
    // 2. Remove the MCP entry if it was written.
    if (writtenMcp) {
      try {
        await removeMcpEntry(writtenMcp, cwd);
        cleanedItems.push({ kind: "mcp_entry", id: writtenMcp });
      } catch (rerr) {
        failedItems.push({ kind: "mcp_entry", id: writtenMcp, error: (rerr as Error).message });
      }
    }
    // 3. Tear down the upstream resource (if provider supports it).

    // Timeout errors: rollback (secrets/MCP) already done above — re-throw
    // the original PROVISION_TIMEOUT so the caller sees the real error code.
    // Deprovision is still attempted below before we re-throw.
    const isTimeout =
      err instanceof StackError && err.code === "PROVISION_TIMEOUT";

    if (provider.deprovision) {
      // If deprovision itself throws, we still want to surface the original
      // failure AND note that teardown was incomplete — otherwise the caller
      // has no idea whether the upstream resource is still live.
      let teardownErr: Error | undefined;
      try {
        const _dt0 = Date.now();
        await provider.deprovision(ctx, auth, resource.id);
        instrumentation.recordStep("deprovision", provider.name, Date.now() - _dt0, "success");
        cleanedItems.push({ kind: "upstream_resource", id: resource.id });
      } catch (derr) {
        teardownErr = derr as Error;
        instrumentation.recordStep(
          "deprovision",
          provider.name,
          0,
          "failure",
          teardownErr.message,
        );
        failedItems.push({
          kind: "upstream_resource",
          id: resource.id,
          error: teardownErr.message,
        });
      }

      // Emit rollback event with full context.
      const recoverySuggestion = teardownErr
        ? `Resource ${resource.id} may still exist on ${provider.displayName}. Delete it manually on the dashboard, then run \`stack doctor --fix\`.`
        : `Rollback complete. Run \`stack doctor\` to verify state.`;
      instrumentation.recordRollback(
        provider.name,
        resource.id,
        (err as Error).message,
        cleanedItems,
        failedItems,
        recoverySuggestion,
      );

      const teardownNote = teardownErr
        ? `Attempted automatic teardown but it FAILED (${teardownErr.message}) — resource ${resource.id} may still exist. Clean it up manually on the ${provider.displayName} dashboard.`
        : `Upstream resource ${resource.id} has been torn down.`;
      // For timeout errors, re-throw the original so callers see PROVISION_TIMEOUT.
      if (isTimeout) throw err;
      throw new StackError(
        "ADD_SERVICE_ROLLED_BACK",
        `Rolled back ${provider.displayName} after failure at step "${failStep}". ` +
          `${teardownNote} ` +
          `Original error: ${(err as Error).message}`,
      );
    }

    // No deprovision support — emit partial-failure event and warn.
    const partialState: import("./instrumentation.ts").PartialStateItem[] = [
      { kind: "upstream_resource", id: resource.id, written: true },
      ...writtenSecrets.map((k) => ({
        kind: "secret" as const,
        id: k,
        written: true,
      })),
      ...(writtenMcp ? [{ kind: "mcp_entry" as const, id: writtenMcp, written: true }] : []),
    ];
    const suggestion =
      `Delete resource ${resource.id} manually on the ${provider.displayName} dashboard, then run \`stack doctor --fix\`.`;
    instrumentation.recordPartialFailure(
      provider.name,
      failStep,
      (err as Error).message,
      errCode,
      partialState,
      suggestion,
    );
    instrumentation.recordRollback(
      provider.name,
      resource.id,
      (err as Error).message,
      cleanedItems,
      [{ kind: "upstream_resource", id: resource.id, error: "provider has no deprovision support" }],
      suggestion,
    );

    ctx.log({
      level: "warn",
      msg: `[stack] Partial failure adding ${provider.displayName}. Upstream resource ID: ${resource.id}. This provider does not support automatic teardown — please delete it manually, then run \`stack doctor --fix\` to resync local state.`,
      data: { provider: provider.name, resourceId: resource.id },
    });
    throw new StackError(
      "ADD_SERVICE_PARTIAL_FAILURE",
      `Adding ${provider.displayName} failed at step "${failStep}" after the upstream resource was created. ` +
        `Resource ID: ${resource.id}. ` +
        `Clean it up manually on the ${provider.displayName} dashboard, then run \`stack doctor --fix\`.`,
    );
    // .stack.toml is intentionally NOT written — the add was not atomic.
  }
}

// ---------------------------------------------------------------------------
// resumeProvisionFromLog — crash-recovery entry point
// ---------------------------------------------------------------------------

/**
 * Context passed into resumeProvisionFromLog by callers (CLI / tests).
 * Mirrors AddServiceOpts but requires cwd and omits sessionId (we already know it).
 */
export interface ResumeProvisionOpts {
  cwd: string;
  interactive?: boolean;
  log?: (event: LogEvent) => void;
  timeoutMs?: number;
}

/**
 * Read the replay log for `sessionId` and re-run `addService` only for the
 * steps that did NOT complete successfully.
 *
 * Rules:
 * - If "login" completed → pass `existingResourceId` from the "provision"
 *   completed entry so the provider skips re-creating the upstream resource.
 * - If "provision" completed → pass the captured `resourceId` as
 *   `existingResourceId`; the login step will still run (credentials may have
 *   expired) but provision is skipped at the provider level.
 * - If "secrets" is partial → the partial items are noted in the log; recovery
 *   re-runs the full addService (provider deduplicates idempotently via
 *   existingResourceId).
 * - Completed sessions (finalStatus === "success") are not re-run.
 *
 * Returns the `AddServiceResult` from the replayed addService call, or throws
 * if the session cannot be recovered (unknown sessionId, already succeeded, etc).
 */
export async function resumeProvisionFromLog(
  sessionId: string,
  opts: ResumeProvisionOpts,
): Promise<AddServiceResult> {
  const meta = readReplaySessionMeta(sessionId);
  if (!meta) {
    throw new StackError(
      "RESUME_SESSION_NOT_FOUND",
      `No replay session found for id "${sessionId}". Run \`stack resume\` without arguments to list recent sessions.`,
    );
  }

  if (meta.finalStatus === "success") {
    throw new StackError(
      "RESUME_SESSION_ALREADY_SUCCEEDED",
      `Session "${sessionId}" already completed successfully — nothing to resume.`,
    );
  }

  const entries = readReplayLog(sessionId);

  // Find the last completed step for each step name (entries are appended in order;
  // the last entry for a name wins — an in_progress followed by completed = completed).
  const stepStatus = new Map<string, ProvisionReplayLog>();
  for (const entry of entries) {
    stepStatus.set(entry.stepName, entry);
  }

  const provisionEntry = stepStatus.get("provision");
  const provisionCompleted =
    provisionEntry?.status === "completed" && typeof provisionEntry.output.resourceId === "string";

  // If provision completed we can skip re-creating the upstream resource by
  // passing existingResourceId.  This is the core of idempotent replay.
  const existingResourceId = provisionCompleted
    ? (provisionEntry!.output.resourceId as string)
    : undefined;

  return addService({
    providerName: meta.providerName,
    cwd: opts.cwd,
    interactive: opts.interactive,
    log: opts.log,
    timeoutMs: opts.timeoutMs,
    existingResourceId,
    // Assign the same sessionId so the log is updated in-place rather than
    // creating a new session file alongside the old one.
    sessionId,
  });
}
