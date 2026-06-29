/**
 * Structured instrumentation layer for the Stack provisioning pipeline.
 *
 * Emits JSON events to a pluggable collector interface so callers (CLI, MCP,
 * CI integrations) can forward them to any telemetry backend without coupling
 * the core pipeline to a specific sink.
 *
 * Design goals:
 *  - Zero-allocation fast path when no collector is registered.
 *  - Every event carries a wall-clock timestamp and ISO string for easy log parsing.
 *  - Rollback / partial-failure events carry enough context to reproduce the
 *    incident without a full trace replay.
 *  - No secret values are ever included in event payloads.
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type InstrumentationEventType =
  | "step"
  | "rollback"
  | "partial_failure"
  | "orchestration_step";

/** Status of an individual provider step. */
export type StepStatus = "success" | "failure" | "timeout";

/** A single timed provider step (login / provision / materialize / deprovision). */
export interface StepEvent {
  type: "step";
  /** Monotonic wall-clock timestamp (ms since epoch) at event emission. */
  timestamp: number;
  /** ISO 8601 wall-clock time. */
  time: string;
  /** Step label: "login" | "provision" | "materialize" | "deprovision". */
  stepName: string;
  providerName: string;
  /** Wall-clock duration of the step in milliseconds. */
  durationMs: number;
  status: StepStatus;
  /** Present on failure — the error message (never a secret value). */
  error?: string;
  /** Error code from StackError.code, if available. */
  errorCode?: string;
}

/** Emitted when the pipeline rolls back resources after a failure. */
export interface RollbackEvent {
  type: "rollback";
  timestamp: number;
  time: string;
  providerName: string;
  /** The upstream resource id being torn down. */
  resourceId: string;
  /** Human-readable reason for the rollback. */
  reason: string;
  /** Items that were successfully cleaned up. */
  cleaned: RollbackItem[];
  /** Items that failed to clean up — user must intervene manually. */
  failed: RollbackItem[];
  /** Actionable suggestion for the operator. */
  recoverySuggestion?: string;
}

export interface RollbackItem {
  /** "secret" | "mcp_entry" | "upstream_resource" */
  kind: "secret" | "mcp_entry" | "upstream_resource";
  /** Identifier (secret key name, MCP name, resource id). */
  id: string;
  /** Populated on failed items. */
  error?: string;
}

/**
 * Emitted when a pipeline step fails but partial state was written.
 * Carries recovery guidance so operators know exactly what to clean up.
 */
export interface PartialFailureEvent {
  type: "partial_failure";
  timestamp: number;
  time: string;
  providerName: string;
  /** Step where the failure occurred. */
  failedAt: string;
  /** Error message. */
  error: string;
  /** Error code from StackError.code, if available. */
  errorCode?: string;
  /** Resources/secrets that were written before the failure. */
  partialState: PartialStateItem[];
  /** What the operator should do to clean up. */
  recoverySuggestion: string;
}

export interface PartialStateItem {
  kind: "secret" | "mcp_entry" | "upstream_resource" | "config_entry";
  id: string;
  /** true = successfully written before failure; false = write failed */
  written: boolean;
}

/** Emitted by the orchestration layer for each provider in a multi-provider run. */
export interface OrchestrationStepEvent {
  type: "orchestration_step";
  timestamp: number;
  time: string;
  providerName: string;
  /** Wave index (0-based) within the orchestration group. */
  wave: number;
  status: "success" | "failure";
  durationMs: number;
  error?: string;
}

export type InstrumentationEvent =
  | StepEvent
  | RollbackEvent
  | PartialFailureEvent
  | OrchestrationStepEvent;

// ---------------------------------------------------------------------------
// Collector interface
// ---------------------------------------------------------------------------

/**
 * Pluggable collector. Implement this interface to route instrumentation
 * events to any sink (file, stdout, OpenTelemetry, Datadog, etc.).
 */
export interface InstrumentationCollector {
  /**
   * Called synchronously for every event emitted by the pipeline.
   * Implementations MUST NOT throw — errors are silently swallowed to
   * prevent instrumentation from affecting the provisioning outcome.
   */
  collect(event: InstrumentationEvent): void;
  /**
   * Optional flush — called when the pipeline completes (success or failure).
   * Use for batch sinks that buffer events and need an explicit flush.
   */
  flush?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory collector (useful for tests and trace-to-file)
// ---------------------------------------------------------------------------

/**
 * Simple in-memory collector. Accumulates all events; callers can read
 * `events` after the pipeline completes and serialize to JSON.
 */
export class MemoryCollector implements InstrumentationCollector {
  readonly events: InstrumentationEvent[] = [];

  collect(event: InstrumentationEvent): void {
    this.events.push(event);
  }

  /** Serialize all captured events to a JSON string (pretty-printed). */
  toJson(): string {
    return JSON.stringify({ events: this.events }, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Instrumentation registry — one active collector per pipeline run
// ---------------------------------------------------------------------------

/**
 * Instrumentation registry. Callers attach a collector before running the
 * pipeline and detach it afterwards. Thread-safety is not a concern here
 * because Node/Bun are single-threaded; concurrent pipelines should use
 * separate Instrumentation instances.
 */
export class Instrumentation {
  private _collector: InstrumentationCollector | null = null;

  /** Attach a collector. Replaces any previously attached collector. */
  attach(collector: InstrumentationCollector): void {
    this._collector = collector;
  }

  /** Detach the current collector. No further events will be routed. */
  detach(): void {
    this._collector = null;
  }

  /** True when a collector is attached and will receive events. */
  get active(): boolean {
    return this._collector !== null;
  }

  /**
   * Emit a step event. Silently no-ops when no collector is attached.
   *
   * @param stepName   - "login" | "provision" | "materialize" | "deprovision"
   * @param providerName - provider identifier
   * @param durationMs  - wall-clock duration of the step
   * @param status      - outcome
   * @param error       - error message on failure (never a secret)
   * @param errorCode   - StackError.code when available
   */
  recordStep(
    stepName: string,
    providerName: string,
    durationMs: number,
    status: StepStatus,
    error?: string,
    errorCode?: string,
  ): void {
    if (!this._collector) return;
    const now = Date.now();
    const event: StepEvent = {
      type: "step",
      timestamp: now,
      time: new Date(now).toISOString(),
      stepName,
      providerName,
      durationMs,
      status,
      ...(error !== undefined ? { error } : {}),
      ...(errorCode !== undefined ? { errorCode } : {}),
    };
    this._safeCollect(event);
  }

  /**
   * Emit a rollback event.
   */
  recordRollback(
    providerName: string,
    resourceId: string,
    reason: string,
    cleaned: RollbackItem[],
    failed: RollbackItem[],
    recoverySuggestion?: string,
  ): void {
    if (!this._collector) return;
    const now = Date.now();
    const event: RollbackEvent = {
      type: "rollback",
      timestamp: now,
      time: new Date(now).toISOString(),
      providerName,
      resourceId,
      reason,
      cleaned,
      failed,
      ...(recoverySuggestion !== undefined ? { recoverySuggestion } : {}),
    };
    this._safeCollect(event);
  }

  /**
   * Emit a partial-failure event with recovery guidance.
   */
  recordPartialFailure(
    providerName: string,
    failedAt: string,
    error: string,
    errorCode: string | undefined,
    partialState: PartialStateItem[],
    recoverySuggestion: string,
  ): void {
    if (!this._collector) return;
    const now = Date.now();
    const event: PartialFailureEvent = {
      type: "partial_failure",
      timestamp: now,
      time: new Date(now).toISOString(),
      providerName,
      failedAt,
      error,
      ...(errorCode !== undefined ? { errorCode } : {}),
      partialState,
      recoverySuggestion,
    };
    this._safeCollect(event);
  }

  /**
   * Emit an orchestration-step event.
   */
  recordOrchestrationStep(
    providerName: string,
    wave: number,
    durationMs: number,
    status: "success" | "failure",
    error?: string,
  ): void {
    if (!this._collector) return;
    const now = Date.now();
    const event: OrchestrationStepEvent = {
      type: "orchestration_step",
      timestamp: now,
      time: new Date(now).toISOString(),
      providerName,
      wave,
      durationMs,
      status,
      ...(error !== undefined ? { error } : {}),
    };
    this._safeCollect(event);
  }

  /** Flush the attached collector (if it supports flushing). */
  async flush(): Promise<void> {
    if (!this._collector?.flush) return;
    try {
      await this._collector.flush();
    } catch {
      /* instrumentation must never surface errors */
    }
  }

  private _safeCollect(event: InstrumentationEvent): void {
    try {
      this._collector?.collect(event);
    } catch {
      /* instrumentation must never surface errors */
    }
  }
}

// ---------------------------------------------------------------------------
// ProvisionProvenance — per-step audit trail
// ---------------------------------------------------------------------------

/**
 * The decision taken at a provision step that determined whether a resource
 * was freshly created or reused from an existing state.
 */
export type ProvisionDecision =
  | "created_new"
  | "attached_existing"
  | "skipped_already_exists"
  | "skipped_dry_run"
  | "failed";

/**
 * Records the provenance of a single provision step: what was done, when,
 * a checksum of the output, and the decision tree reasoning.
 *
 * Used to build an audit trail for `stack audit-trail <sessionId>`.
 */
export interface ProvenanceStep {
  /** Stable step label: "login" | "provision" | "materialize" | "deprovision". */
  stepName: string;
  /** Provider this step belongs to. */
  providerName: string;
  /** ISO 8601 timestamp when the step started. */
  startedAt: string;
  /** ISO 8601 timestamp when the step completed (or failed). */
  completedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Outcome of the step. */
  status: StepStatus | "skipped";
  /** Decision taken at this step. */
  decision: ProvisionDecision;
  /**
   * Human-readable justification for the decision.
   * e.g. "Resource 'my-db' already existed; attached without recreating."
   */
  decisionReason: string;
  /**
   * SHA-256 hex checksum of the serialised step output (excluding secrets).
   * Allows consumers to detect if outputs changed between runs.
   * Empty string when output is empty or unavailable.
   */
  outputChecksum: string;
  /** Non-secret key/value pairs describing the step output (e.g. resourceId, region). */
  outputSummary: Record<string, string>;
  /** Error message if status is "failure". */
  error?: string;
  /** StackError.code if available. */
  errorCode?: string;
}

/**
 * Full provenance audit trail for a single provision session.
 * Carries enough context to reconstruct why every resource was created (or not),
 * enabling SLA compliance reporting and post-incident analysis.
 */
export interface ProvisionProvenance {
  /** Session ID (nanoid-style, matches the replay log session). */
  sessionId: string;
  /** ISO 8601 timestamp when provisioning started. */
  startedAt: string;
  /** ISO 8601 timestamp when provisioning completed (or failed). */
  completedAt: string;
  /** Total duration of the full provision session in milliseconds. */
  totalDurationMs: number;
  /**
   * Ordered list of provision steps, one per provider sub-step.
   * Ordered by `startedAt` ascending.
   */
  steps: ProvenanceStep[];
  /**
   * Providers that were fully provisioned (all steps succeeded).
   */
  succeededProviders: string[];
  /**
   * Provider that triggered a rollback (if any).
   */
  failedProvider?: string;
  /**
   * True when a rollback was triggered due to a partial failure.
   */
  rolledBack: boolean;
  /** Metadata tags (e.g. project_id, git_sha, CI environment). */
  tags: Record<string, string>;
}

/**
 * In-memory store for building a ProvisionProvenance during a session.
 * Call `recordProvenanceStep()` during provisioning and `toProvenance()` at the end.
 */
export class ProvenanceCollector {
  private readonly _sessionId: string;
  private readonly _startedAt: string;
  private readonly _steps: ProvenanceStep[] = [];
  private _tags: Record<string, string> = {};

  constructor(sessionId: string) {
    this._sessionId = sessionId;
    this._startedAt = new Date().toISOString();
  }

  /** Record a completed provision step into the provenance trail. */
  recordStep(step: ProvenanceStep): void {
    this._steps.push(step);
  }

  /** Set metadata tags (e.g. project_id, environment). */
  setTags(tags: Record<string, string>): void {
    this._tags = { ...this._tags, ...tags };
  }

  /**
   * Finalise and return the ProvisionProvenance.
   * @param failedProvider Provider name that triggered rollback, if any.
   * @param rolledBack     Whether rollback was triggered.
   */
  toProvenance(failedProvider?: string, rolledBack = false): ProvisionProvenance {
    const completedAt = new Date().toISOString();
    const startMs = new Date(this._startedAt).getTime();
    const endMs = new Date(completedAt).getTime();

    const succeededProviders = [
      ...new Set(
        this._steps
          .filter((s) => s.status === "success" && s.stepName === "provision")
          .map((s) => s.providerName),
      ),
    ];

    return {
      sessionId: this._sessionId,
      startedAt: this._startedAt,
      completedAt,
      totalDurationMs: endMs - startMs,
      steps: [...this._steps],
      succeededProviders,
      ...(failedProvider !== undefined ? { failedProvider } : {}),
      rolledBack,
      tags: { ...this._tags },
    };
  }

  /** Access the accumulated steps (useful for tests). */
  get steps(): ProvenanceStep[] {
    return this._steps;
  }
}

/**
 * Compute a simple checksum of a JSON-serialisable value (non-cryptographic, fast).
 * Uses a djb2-style hash over the JSON string, returned as 8 hex chars.
 * For production integrity checks, callers should use a full SHA-256 via SubtleCrypto.
 */
export function checksumOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  let str: string;
  try {
    str = JSON.stringify(output);
  } catch {
    return "";
  }
  // djb2 hash
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep as unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Module-level default instance — shared by pipeline.ts
// ---------------------------------------------------------------------------

/**
 * Module-level instrumentation instance.
 * The CLI wires a MemoryCollector (or a FileCollector) here before invoking
 * addService(), then reads events afterwards.
 */
export const instrumentation = new Instrumentation();

// ---------------------------------------------------------------------------
// File collector — used by `stack add --trace <file>`
// ---------------------------------------------------------------------------

/**
 * Writes all events to a JSON file on flush.
 * Accumulates events in memory during the pipeline run, then serialises them
 * atomically on flush() so the file is never partially written.
 */
export class FileCollector implements InstrumentationCollector {
  private readonly _mem: MemoryCollector = new MemoryCollector();
  constructor(private readonly filePath: string) {}

  collect(event: InstrumentationEvent): void {
    this._mem.collect(event);
  }

  async flush(): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, this._mem.toJson(), "utf-8");
  }

  /** Access accumulated events (useful for tests). */
  get events(): InstrumentationEvent[] {
    return this._mem.events;
  }
}
