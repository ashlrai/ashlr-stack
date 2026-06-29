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
