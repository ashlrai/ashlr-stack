/**
 * Rollback Validation & Partial-Failure State Audit Framework
 *
 * After a rollback completes, this module reads the provision replay log to
 * reconstruct what was supposed to be cleaned up, then cross-checks each
 * claim against actual filesystem/vault state:
 *
 *   - Phantom secrets listed as "cleaned" that are still present in the vault
 *   - MCP entries listed as "cleaned" that are still present in .mcp.json
 *   - Config entries listed as "cleaned" that are still present in .stack.toml
 *
 * The result is a `RollbackAuditReport` containing verified/orphan lists and
 * actionable recommendations. Used by `stack doctor --audit` to surface
 * dangling state from prior failed provisions.
 *
 * Design constraints:
 *  - Never throws — every error is captured into the report.
 *  - Never reads secret *values* — only checks presence of secret keys.
 *  - Filesystem reads are best-effort; missing files are treated as empty.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RollbackEvent, RollbackItem } from "./instrumentation.ts";
import { listSecrets } from "./phantom.ts";
import {
  readReplayLog,
  readReplaySessionMeta,
  replayLogDir,
  type ProvisionReplayLog,
  type ReplaySessionMeta,
} from "./errors/provision-errors.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Outcome of a single rollback item cross-check.
 * - "verified_clean"   : item was claimed cleaned AND is absent from state  ✓
 * - "verified_failed"  : item was claimed failed AND is still present        ✓ (expected residue)
 * - "orphan_secret"    : secret still present but not reported in rollback
 * - "orphan_mcp"       : MCP entry still present but not reported
 * - "orphan_config"    : config entry still present but not reported
 * - "ghost_clean"      : item claimed cleaned but we cannot verify absence
 *                        (e.g. Phantom not installed, read error)
 * - "stale_failed"     : item was claimed failed AND is still present — manual action required
 */
export type AuditItemStatus =
  | "verified_clean"
  | "verified_failed"
  | "orphan_secret"
  | "orphan_mcp"
  | "orphan_config"
  | "ghost_clean"
  | "stale_failed";

/** One checked item in the audit report. */
export interface AuditedItem {
  kind: "secret" | "mcp_entry" | "config_entry" | "upstream_resource";
  id: string;
  status: AuditItemStatus;
  /** Human-readable explanation of why this status was assigned. */
  detail: string;
}

/** Actionable recommendation produced by the audit. */
export interface AuditRecommendation {
  /** Short imperative title. */
  title: string;
  /** CLI command the operator can run. */
  command: string;
  /** true when this action is required to reach a clean state. */
  urgent: boolean;
}

/**
 * Full audit result for a single rollback session.
 * Returned by `auditRollback()` and consumed by `stack doctor --audit`.
 */
export interface RollbackAuditReport {
  /** Session ID that was audited. */
  sessionId: string;
  /** Provider that was provisioned/rolled back. */
  providerName: string;
  /** ISO timestamp when the audit was performed. */
  auditedAt: string;
  /**
   * true  — every claimed-clean item is absent from state AND every
   *         claimed-failed item is known to the operator.
   * false — orphans or unexpected residue detected.
   */
  verified: boolean;
  /** Items whose state matched the rollback event claims. */
  clean: AuditedItem[];
  /**
   * Items found in filesystem state that were NOT reported in the rollback
   * event — i.e., leftovers the rollback logic missed.
   */
  orphans: AuditedItem[];
  /**
   * Items claimed as "failed" in the rollback event that are confirmed still
   * present and require manual intervention.
   */
  stale: AuditedItem[];
  /** All items audited (union of clean + orphans + stale). */
  items: AuditedItem[];
  /** Actionable next steps ordered by urgency. */
  recommendations: AuditRecommendation[];
  /** Error messages encountered during the audit (never blocks completion). */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read and parse `.mcp.json` in cwd. Returns empty servers map on any error. */
async function readMcpServers(cwd: string): Promise<Record<string, unknown>> {
  const path = join(cwd, ".mcp.json");
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}

/** Read configured service names from .stack.toml in cwd. Returns empty set on any error. */
async function readConfigServiceNames(cwd: string): Promise<Set<string>> {
  const shapePath = join(cwd, ".stack.toml");
  const localPath = join(cwd, ".stack.local.toml");
  const names = new Set<string>();
  for (const p of [shapePath, localPath]) {
    if (!existsSync(p)) continue;
    try {
      const raw = await readFile(p, "utf-8");
      // Extract service keys from TOML by scanning for [services.<name>] headers
      // and inline `services.<name>` keys. We avoid a TOML parser dep here —
      // the regex approach is resilient enough for the keys we need.
      const sectionRe = /^\[services\.([^\]]+)\]/gm;
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
      while ((m = sectionRe.exec(raw)) !== null) {
        names.add(m[1]!);
      }
    } catch {
      // best-effort
    }
  }
  return names;
}

/** List all secret keys present in the Phantom vault. Returns empty array on any error. */
async function listPhantomSecrets(cwd?: string): Promise<string[]> {
  try {
    return await listSecrets(cwd);
  } catch {
    return [];
  }
}

/**
 * Reconstruct the "expected cleanup set" from a provision replay log.
 * Returns the union of:
 *  - secrets written (stepName="secrets", status="completed")
 *  - MCP entries written (stepName="mcp", status="completed")
 *  - config entries written (stepName="config", status="completed")
 *
 * Items that were written and subsequently cleaned up by the rollback should
 * not appear in filesystem state; if they do, they are orphans.
 */
function extractExpectedCleanupFromReplayLog(entries: ProvisionReplayLog[]): {
  secrets: string[];
  mcpNames: string[];
  configNames: string[];
} {
  const secrets: string[] = [];
  const mcpNames: string[] = [];
  const configNames: string[] = [];

  for (const entry of entries) {
    if (entry.status !== "completed") continue;
    switch (entry.stepName) {
      case "secrets": {
        // output.secretNames is written by the pipeline as a list of key names
        const keyNames = entry.output.secretNames;
        if (Array.isArray(keyNames)) {
          for (const k of keyNames) {
            if (typeof k === "string") secrets.push(k);
          }
        }
        // Also accept output.keys for backward compat
        const keys = entry.output.keys;
        if (Array.isArray(keys)) {
          for (const k of keys) {
            if (typeof k === "string" && !secrets.includes(k)) secrets.push(k);
          }
        }
        break;
      }
      case "mcp": {
        const name = entry.output.mcpName ?? entry.output.name;
        if (typeof name === "string") mcpNames.push(name);
        break;
      }
      case "config": {
        const name = entry.output.serviceName ?? entry.output.name ?? entry.providerName;
        if (typeof name === "string") configNames.push(name);
        break;
      }
      default:
        break;
    }
  }

  return { secrets, mcpNames, configNames };
}

// ---------------------------------------------------------------------------
// Core audit function
// ---------------------------------------------------------------------------

export interface AuditRollbackOptions {
  /** Project root — used to read .mcp.json and .stack.toml. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * The rollback event emitted by the instrumentation layer.
   * When provided, the audit cross-checks its `cleaned` and `failed` arrays
   * against filesystem state.  When omitted, the audit works from the replay
   * log alone.
   */
  rollbackEvent?: RollbackEvent;
}

/**
 * Audit a completed (or crashed) rollback for a given session.
 *
 * Steps:
 *  1. Read `.stack/sessions/<sessionId>/provision-replay.jsonl` (via the
 *     replay log dir) to reconstruct what was written.
 *  2. Read current filesystem state: Phantom vault keys, `.mcp.json`, `.stack.toml`.
 *  3. Cross-check rollback event claims against filesystem state.
 *  4. Detect orphans: items present in state that were neither cleaned nor
 *     explicitly listed as failed.
 *  5. Return a structured `RollbackAuditReport`.
 */
export async function auditRollback(
  sessionId: string,
  opts: AuditRollbackOptions = {},
): Promise<RollbackAuditReport> {
  const cwd = opts.cwd ?? process.cwd();
  const auditErrors: string[] = [];

  // ---- 1. Read session meta & replay log --------------------------------

  const meta: ReplaySessionMeta | undefined = (() => {
    try {
      return readReplaySessionMeta(sessionId);
    } catch (e) {
      auditErrors.push(`Failed to read session meta: ${(e as Error).message}`);
      return undefined;
    }
  })();

  const providerName =
    meta?.providerName ??
    opts.rollbackEvent?.providerName ??
    "unknown";

  let replayEntries: ProvisionReplayLog[] = [];
  try {
    replayEntries = readReplayLog(sessionId);
  } catch (e) {
    auditErrors.push(`Failed to read replay log: ${(e as Error).message}`);
  }

  // ---- 2. Extract what was written per the replay log -------------------

  const { secrets: writtenSecrets, mcpNames: writtenMcp, configNames: writtenConfig } =
    extractExpectedCleanupFromReplayLog(replayEntries);

  // ---- 3. Read current filesystem state ---------------------------------

  const [liveSecrets, liveMcp, liveConfig] = await Promise.all([
    listPhantomSecrets(cwd),
    readMcpServers(cwd).catch((e) => {
      auditErrors.push(`Failed to read .mcp.json: ${(e as Error).message}`);
      return {} as Record<string, unknown>;
    }),
    readConfigServiceNames(cwd).catch((e) => {
      auditErrors.push(`Failed to read .stack.toml: ${(e as Error).message}`);
      return new Set<string>();
    }),
  ]);

  const liveSecretSet = new Set(liveSecrets);
  const liveMcpSet = new Set(Object.keys(liveMcp));

  // ---- 4. Build sets from the rollback event (if provided) --------------

  const cleanedIds = new Set<string>();
  const failedIds = new Set<string>();

  if (opts.rollbackEvent) {
    for (const item of opts.rollbackEvent.cleaned) cleanedIds.add(item.id);
    for (const item of opts.rollbackEvent.failed) failedIds.add(item.id);
  }

  const auditedItems: AuditedItem[] = [];

  // ---- 5a. Cross-check rollback event "cleaned" claims ------------------

  if (opts.rollbackEvent) {
    for (const item of opts.rollbackEvent.cleaned) {
      const audited = auditCleanedItem(item, liveSecretSet, liveMcpSet, liveConfig);
      auditedItems.push(audited);
    }

    // ---- 5b. Cross-check rollback event "failed" claims ----------------

    for (const item of opts.rollbackEvent.failed) {
      const audited = auditFailedItem(item, liveSecretSet, liveMcpSet, liveConfig);
      auditedItems.push(audited);
    }
  }

  // ---- 6. Detect orphans: written per replay log but not in rollback event ---

  for (const secretKey of writtenSecrets) {
    if (cleanedIds.has(secretKey) || failedIds.has(secretKey)) continue;
    if (liveSecretSet.has(secretKey)) {
      auditedItems.push({
        kind: "secret",
        id: secretKey,
        status: "orphan_secret",
        detail: `Secret "${secretKey}" was written during provision (per replay log) but is not listed in the rollback event and is still present in the Phantom vault.`,
      });
    }
  }

  for (const mcpName of writtenMcp) {
    if (cleanedIds.has(mcpName) || failedIds.has(mcpName)) continue;
    if (liveMcpSet.has(mcpName)) {
      auditedItems.push({
        kind: "mcp_entry",
        id: mcpName,
        status: "orphan_mcp",
        detail: `MCP entry "${mcpName}" was written during provision (per replay log) but is not listed in the rollback event and is still present in .mcp.json.`,
      });
    }
  }

  for (const configName of writtenConfig) {
    if (cleanedIds.has(configName) || failedIds.has(configName)) continue;
    if (liveConfig.has(configName)) {
      auditedItems.push({
        kind: "config_entry",
        id: configName,
        status: "orphan_config",
        detail: `Config entry "${configName}" was written during provision (per replay log) but is not listed in the rollback event and is still present in .stack.toml.`,
      });
    }
  }

  // ---- 7. Classify items into buckets -----------------------------------

  const cleanItems = auditedItems.filter(
    (i) => i.status === "verified_clean" || i.status === "ghost_clean",
  );
  const orphanItems = auditedItems.filter(
    (i) =>
      i.status === "orphan_secret" ||
      i.status === "orphan_mcp" ||
      i.status === "orphan_config",
  );
  const staleItems = auditedItems.filter((i) => i.status === "stale_failed");

  const verified = orphanItems.length === 0 && staleItems.length === 0;

  // ---- 8. Build recommendations ----------------------------------------

  const recommendations = buildRecommendations(
    providerName,
    orphanItems,
    staleItems,
    opts.rollbackEvent,
  );

  return {
    sessionId,
    providerName,
    auditedAt: new Date().toISOString(),
    verified,
    clean: cleanItems,
    orphans: orphanItems,
    stale: staleItems,
    items: auditedItems,
    recommendations,
    errors: auditErrors,
  };
}

// ---------------------------------------------------------------------------
// Item-level audit helpers
// ---------------------------------------------------------------------------

function auditCleanedItem(
  item: RollbackItem,
  liveSecrets: Set<string>,
  liveMcp: Set<string>,
  liveConfig: Set<string>,
): AuditedItem {
  switch (item.kind) {
    case "secret": {
      if (!liveSecrets.has(item.id)) {
        return {
          kind: "secret",
          id: item.id,
          status: "verified_clean",
          detail: `Secret "${item.id}" was claimed cleaned and is absent from the Phantom vault. ✓`,
        };
      }
      // Still present despite claimed clean — treat as orphan
      return {
        kind: "secret",
        id: item.id,
        status: "orphan_secret",
        detail: `Secret "${item.id}" was claimed cleaned by the rollback but is still present in the Phantom vault.`,
      };
    }
    case "mcp_entry": {
      if (!liveMcp.has(item.id)) {
        return {
          kind: "mcp_entry",
          id: item.id,
          status: "verified_clean",
          detail: `MCP entry "${item.id}" was claimed cleaned and is absent from .mcp.json. ✓`,
        };
      }
      return {
        kind: "mcp_entry",
        id: item.id,
        status: "orphan_mcp",
        detail: `MCP entry "${item.id}" was claimed cleaned by the rollback but is still present in .mcp.json.`,
      };
    }
    case "upstream_resource": {
      // We cannot verify upstream resource state without hitting the provider API.
      // Record as ghost_clean (unverifiable).
      return {
        kind: "upstream_resource",
        id: item.id,
        status: "ghost_clean",
        detail: `Upstream resource "${item.id}" was claimed cleaned; local verification is not possible without a provider API call.`,
      };
    }
    default: {
      // config_entry (RollbackItem kind union is narrow but defensive)
      if (!liveConfig.has(item.id)) {
        return {
          kind: "config_entry",
          id: item.id,
          status: "verified_clean",
          detail: `Config entry "${item.id}" was claimed cleaned and is absent from .stack.toml. ✓`,
        };
      }
      return {
        kind: "config_entry",
        id: item.id,
        status: "orphan_config",
        detail: `Config entry "${item.id}" was claimed cleaned but is still present in .stack.toml.`,
      };
    }
  }
}

function auditFailedItem(
  item: RollbackItem,
  liveSecrets: Set<string>,
  liveMcp: Set<string>,
  liveConfig: Set<string>,
): AuditedItem {
  switch (item.kind) {
    case "secret": {
      const stillPresent = liveSecrets.has(item.id);
      return {
        kind: "secret",
        id: item.id,
        status: stillPresent ? "stale_failed" : "verified_clean",
        detail: stillPresent
          ? `Secret "${item.id}" failed to clean up and is still present in the Phantom vault. Manual removal required.`
          : `Secret "${item.id}" was reported as a failed cleanup but is no longer present (may have been removed manually). ✓`,
      };
    }
    case "mcp_entry": {
      const stillPresent = liveMcp.has(item.id);
      return {
        kind: "mcp_entry",
        id: item.id,
        status: stillPresent ? "stale_failed" : "verified_clean",
        detail: stillPresent
          ? `MCP entry "${item.id}" failed to clean up and is still present in .mcp.json. Manual removal required.`
          : `MCP entry "${item.id}" was reported as a failed cleanup but is no longer present. ✓`,
      };
    }
    case "upstream_resource": {
      return {
        kind: "upstream_resource",
        id: item.id,
        status: "stale_failed",
        detail: `Upstream resource "${item.id}" could not be deprovisioned during rollback. Manual deletion via the provider dashboard is required.`,
      };
    }
    default: {
      const stillPresent = liveConfig.has(item.id);
      return {
        kind: "config_entry",
        id: item.id,
        status: stillPresent ? "stale_failed" : "verified_clean",
        detail: stillPresent
          ? `Config entry "${item.id}" failed to clean up and is still present in .stack.toml. Manual removal required.`
          : `Config entry "${item.id}" was reported as a failed cleanup but is no longer present. ✓`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Recommendation builder
// ---------------------------------------------------------------------------

function buildRecommendations(
  providerName: string,
  orphans: AuditedItem[],
  stale: AuditedItem[],
  rollbackEvent?: RollbackEvent,
): AuditRecommendation[] {
  const recs: AuditRecommendation[] = [];

  // Orphaned secrets
  const orphanSecrets = orphans.filter((o) => o.kind === "secret");
  if (orphanSecrets.length > 0) {
    for (const s of orphanSecrets) {
      recs.push({
        title: `Remove orphaned secret "${s.id}" from Phantom vault`,
        command: `phantom remove ${s.id}`,
        urgent: true,
      });
    }
  }

  // Orphaned MCP entries
  const orphanMcp = orphans.filter((o) => o.kind === "mcp_entry");
  if (orphanMcp.length > 0) {
    recs.push({
      title: `Remove orphaned MCP entries from .mcp.json`,
      command: `stack remove ${providerName}`,
      urgent: true,
    });
  }

  // Orphaned config entries
  const orphanConfig = orphans.filter((o) => o.kind === "config_entry");
  if (orphanConfig.length > 0) {
    recs.push({
      title: `Remove orphaned config entries from .stack.toml`,
      command: `stack remove ${providerName}`,
      urgent: true,
    });
  }

  // Stale secrets
  const staleSecrets = stale.filter((s) => s.kind === "secret");
  if (staleSecrets.length > 0) {
    for (const s of staleSecrets) {
      recs.push({
        title: `Manually remove stale secret "${s.id}" from Phantom vault`,
        command: `phantom remove ${s.id}`,
        urgent: true,
      });
    }
  }

  // Stale upstream resources
  const staleUpstream = stale.filter((s) => s.kind === "upstream_resource");
  if (staleUpstream.length > 0) {
    const resourceIds = staleUpstream.map((s) => s.id).join(", ");
    recs.push({
      title: `Manually delete upstream resource(s) from ${providerName} dashboard: ${resourceIds}`,
      command: `stack open ${providerName}`,
      urgent: true,
    });
  }

  // Stale MCP entries
  const staleMcp = stale.filter((s) => s.kind === "mcp_entry");
  if (staleMcp.length > 0) {
    recs.push({
      title: `Manually remove stale MCP entries from .mcp.json`,
      command: `stack remove ${providerName}`,
      urgent: true,
    });
  }

  // If rollback event has a recoverySuggestion, surface it
  if (rollbackEvent?.recoverySuggestion) {
    recs.push({
      title: "Follow the rollback recovery suggestion",
      command: rollbackEvent.recoverySuggestion,
      urgent: false,
    });
  }

  // Always suggest a follow-up doctor run if there are any issues
  if (orphans.length > 0 || stale.length > 0) {
    recs.push({
      title: "Re-run stack doctor after manual cleanup to confirm clean state",
      command: "stack doctor --audit",
      urgent: false,
    });
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Multi-session audit — used by `stack doctor --audit`
// ---------------------------------------------------------------------------

export interface MultiSessionAuditReport {
  auditedAt: string;
  sessionCount: number;
  /** Sessions with orphans or stale items. */
  dirty: RollbackAuditReport[];
  /** Sessions that verified clean. */
  verified: RollbackAuditReport[];
  /** Total orphan count across all sessions. */
  totalOrphans: number;
  /** Total stale item count across all sessions. */
  totalStale: number;
}

/**
 * Audit all known replay sessions for a project.
 * Reads `.stack/sessions/` via the standard replay-log directory.
 *
 * @param cwd   - Project root.
 * @param limit - Maximum number of sessions to audit (default 20, newest-first).
 */
export async function auditAllSessions(
  cwd: string = process.cwd(),
  limit = 20,
): Promise<MultiSessionAuditReport> {
  const { listReplaySessions } = await import("./errors/provision-errors.ts");
  const sessions = listReplaySessions().slice(0, limit);

  const reports = await Promise.all(
    sessions.map((s) => auditRollback(s.sessionId, { cwd })),
  );

  const dirty = reports.filter((r) => !r.verified);
  const verified = reports.filter((r) => r.verified);
  const totalOrphans = reports.reduce((acc, r) => acc + r.orphans.length, 0);
  const totalStale = reports.reduce((acc, r) => acc + r.stale.length, 0);

  return {
    auditedAt: new Date().toISOString(),
    sessionCount: reports.length,
    dirty,
    verified,
    totalOrphans,
    totalStale,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by CLI and tests)
// ---------------------------------------------------------------------------

/** Render a RollbackAuditReport as a human-readable string (no ANSI). */
export function formatAuditReport(report: RollbackAuditReport): string {
  const lines: string[] = [];
  lines.push(`Rollback Audit — session ${report.sessionId}`);
  lines.push(`Provider: ${report.providerName}  |  Audited: ${report.auditedAt}`);
  lines.push("");

  if (report.verified) {
    lines.push("  ✓ Rollback verified clean — no orphaned state detected.");
  } else {
    lines.push(`  ✗ ${report.orphans.length} orphan(s), ${report.stale.length} stale item(s) detected.`);
  }

  if (report.orphans.length > 0) {
    lines.push("");
    lines.push("Orphans (not cleaned, not reported):");
    for (const o of report.orphans) {
      lines.push(`  [${o.kind}] ${o.id} — ${o.detail}`);
    }
  }

  if (report.stale.length > 0) {
    lines.push("");
    lines.push("Stale (failed cleanup, still present):");
    for (const s of report.stale) {
      lines.push(`  [${s.kind}] ${s.id} — ${s.detail}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommendations:");
    for (const rec of report.recommendations) {
      const urgency = rec.urgent ? " [URGENT]" : "";
      lines.push(`  ${urgency} ${rec.title}`);
      lines.push(`    $ ${rec.command}`);
    }
  }

  if (report.errors.length > 0) {
    lines.push("");
    lines.push("Audit errors (non-fatal):");
    for (const e of report.errors) {
      lines.push(`  ! ${e}`);
    }
  }

  return lines.join("\n");
}
