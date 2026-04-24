import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";

/**
 * Opt-in anonymous telemetry for Stack CLI.
 *
 * PRIVACY CONTRACT (enforced here, not just documented):
 *  - No data is ever sent unless the user explicitly opted in via promptFirstRun()
 *    or enable(). The STACK_TELEMETRY=1 env var alone does NOT enable telemetry —
 *    it only un-suppresses a prior opt-in.
 *  - STACK_TELEMETRY=0 always forces telemetry off regardless of stored config.
 *  - emit() is fire-and-forget: 1s AbortController timeout, never throws, never blocks.
 *  - Payload is defined by TelemetryEvent. No cwd, project names, provider choices
 *    for specific stacks, secret values, or Phantom data are ever included.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  type: "command" | "error";
  /** e.g. "add", "scan" */
  command: string;
  exitCode: number;
  durationMs: number;
  /** Anonymous UUID per process invocation. */
  runId: string;
  /** Anonymous UUID per machine, generated once on first write and persisted. */
  installId: string;
  stackVersion: string;
  platform: string;
  // Explicitly absent: cwd, project names, secret values, env values,
  // provider chosen for a specific project, stack.toml contents.
}

export interface TelemetryConfig {
  enabled: boolean;
  /** ISO timestamp of first-run prompt. */
  promptedAt?: string;
  installId?: string;
  /** Override for self-hosted endpoint. */
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STACK_VERSION = "0.1.0";
const EMIT_TIMEOUT_MS = 1_000;

// Per-process anonymous run ID — generated once, never persisted.
const RUN_ID: string = crypto.randomUUID();

// ---------------------------------------------------------------------------
// Config path — lazy, with an override hook for tests.
// ---------------------------------------------------------------------------

let _configDirOverride: string | undefined;

/**
 * Override the config directory. FOR TESTS ONLY.
 * Pass `undefined` to restore the default.
 */
export function __setConfigDirForTesting(dir: string | undefined): void {
  _configDirOverride = dir;
}

function configDir(): string {
  return _configDirOverride ?? join(homedir(), ".ashlr", "stack");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

async function readTelemetryConfig(): Promise<TelemetryConfig | null> {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as TelemetryConfig;
  } catch {
    return null;
  }
}

async function writeTelemetryConfig(config: TelemetryConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

async function getOrCreateConfig(): Promise<TelemetryConfig> {
  const existing = await readTelemetryConfig();
  if (existing) return existing;
  const fresh: TelemetryConfig = { enabled: false };
  await writeTelemetryConfig(fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Env-var overrides
// ---------------------------------------------------------------------------

function envForceOff(): boolean {
  return process.env.STACK_TELEMETRY === "0";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true only if the user has previously opted in AND
 * STACK_TELEMETRY=0 is not set.
 *
 * STACK_TELEMETRY=1 does NOT enable telemetry on its own — it only prevents
 * a "0" override from suppressing an already-enabled config. Opt-in is sticky:
 * it requires an affirmative action (promptFirstRun or enable()).
 */
export async function isEnabled(): Promise<boolean> {
  if (envForceOff()) return false;
  const config = await readTelemetryConfig();
  // Opt-in must come from stored config — env var alone is never sufficient.
  return config?.enabled === true;
}

/**
 * Displays a first-run consent prompt on TTY. Returns the user's choice.
 * Persists the result (including installId on opt-in) to config.json.
 * No-ops (returns false) when stdout is not a TTY.
 */
export async function promptFirstRun(): Promise<boolean> {
  const existing = await readTelemetryConfig();
  // Already prompted — don't ask again.
  if (existing?.promptedAt !== undefined) return existing.enabled;
  // Only prompt on interactive terminals.
  if (!process.stdout.isTTY) {
    await writeTelemetryConfig({ enabled: false, promptedAt: new Date().toISOString() });
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      "\nShare anonymous usage telemetry (command + duration, no paths/secrets)?\n" +
        "Note: the telemetry backend is not yet live — opting in now pre-authorizes\n" +
        "collection when it launches. No data is sent until then. [y/N] ",
      (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      },
    );
  });

  const opted = answer === "y" || answer === "yes";
  const installId = opted ? crypto.randomUUID() : undefined;
  await writeTelemetryConfig({
    enabled: opted,
    promptedAt: new Date().toISOString(),
    ...(installId ? { installId } : {}),
  });
  return opted;
}

/**
 * Fire-and-forget telemetry emit. Never throws. Never blocks the caller.
 * If telemetry is disabled, returns immediately without any I/O.
 */
export async function emit(
  event: Partial<TelemetryEvent> & { type: TelemetryEvent["type"]; command: string },
): Promise<void> {
  // Fast path: env says off.
  if (envForceOff()) return;

  let config: TelemetryConfig | null;
  try {
    config = await readTelemetryConfig();
  } catch {
    return;
  }

  // No config or not opted-in: no-op. STACK_TELEMETRY=1 alone never enables.
  if (!config?.enabled) return;

  // Resolve endpoint: env override → persisted config → no-op.
  // The hosted backend is not yet live; emit is a no-op until an endpoint is
  // configured. This prevents fire-and-forget POSTs to a non-existent domain.
  const endpoint = process.env.STACK_TELEMETRY_ENDPOINT?.trim() || config.endpoint?.trim() || null;
  if (!endpoint) return;

  const installId = await ensureInstallId(config);

  const payload: TelemetryEvent = {
    type: event.type,
    command: event.command,
    exitCode: event.exitCode ?? 0,
    durationMs: event.durationMs ?? 0,
    runId: RUN_ID,
    installId,
    stackVersion: STACK_VERSION,
    platform: process.platform,
  };

  // Fire-and-forget: deliberately not awaited at the call site.
  // We wrap in void and swallow all errors.
  void (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EMIT_TIMEOUT_MS);
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      // Intentionally swallowed — telemetry must never surface errors to users.
    }
  })();
}

/** Permanently disable telemetry and persist the change. */
export async function disable(): Promise<void> {
  const config = await getOrCreateConfig();
  await writeTelemetryConfig({ ...config, enabled: false });
}

/** Enable telemetry (only meaningful after the user has explicitly opted in). */
export async function enable(): Promise<void> {
  const config = await getOrCreateConfig();
  const installId = config.installId ?? crypto.randomUUID();
  await writeTelemetryConfig({
    ...config,
    enabled: true,
    installId,
    promptedAt: config.promptedAt ?? new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Ensures an installId exists in config.json and returns it.
 * Generates one if missing (guards against manual config edits).
 */
async function ensureInstallId(config: TelemetryConfig): Promise<string> {
  if (config.installId) return config.installId;
  const installId = crypto.randomUUID();
  await writeTelemetryConfig({ ...config, installId });
  return installId;
}
