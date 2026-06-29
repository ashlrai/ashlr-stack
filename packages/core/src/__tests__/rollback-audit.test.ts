/**
 * Tests for the Rollback Validation & Partial-Failure State Audit Framework.
 *
 * Covers:
 *  1. Successful rollback — all claimed-cleaned items are absent → verified=true
 *  2. Partial rollback — some failed items remain → stale items, verified=false
 *  3. Orphaned state — secrets/MCP entries present but not in rollback event
 *  4. Cascade failures — cleanup of cleanup (ghost_clean for upstream resources)
 *  5. Missing rollback event — audit works from replay log alone
 *  6. formatAuditReport produces correct human-readable output
 *  7. No session → graceful empty report
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RollbackEvent } from "../instrumentation.ts";
import {
  appendReplayLog,
  generateSessionId,
  replayLogDir,
  writeReplaySessionMeta,
} from "../errors/provision-errors.ts";
import {
  auditRollback,
  formatAuditReport,
  type RollbackAuditReport,
} from "../rollback-audit.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Write a minimal .mcp.json with the given server names into cwd. */
async function writeMcp(cwd: string, serverNames: string[]): Promise<void> {
  const mcpServers: Record<string, { type: string; command: string }> = {};
  for (const name of serverNames) {
    mcpServers[name] = { type: "stdio", command: "echo" };
  }
  await writeFile(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers }, null, 2), "utf-8");
}

/** Write a minimal .stack.toml that declares the given service names. */
async function writeStackToml(cwd: string, serviceNames: string[]): Promise<void> {
  let toml = '[stack]\nversion = "1"\n\n';
  for (const name of serviceNames) {
    toml += `[services.${name}]\nprovider = "${name}"\nsecrets = []\n\n`;
  }
  await writeFile(join(cwd, ".stack.toml"), toml, "utf-8");
}

/** Build a rollback event shape. */
function makeRollbackEvent(
  overrides: Partial<RollbackEvent> = {},
): RollbackEvent {
  return {
    type: "rollback",
    timestamp: Date.now(),
    time: new Date().toISOString(),
    providerName: "test-provider",
    resourceId: "res-test-123",
    reason: "materialize failed",
    cleaned: [],
    failed: [],
    ...overrides,
  };
}

/** Write a replay log entry that claims secrets were written. */
function writeSecretsReplayEntry(
  sessionId: string,
  providerName: string,
  secretKeys: string[],
): void {
  appendReplayLog(sessionId, {
    timestamp: new Date().toISOString(),
    stepName: "secrets",
    providerName,
    input: {},
    output: { secretNames: secretKeys },
    status: "completed",
  });
}

/** Write a replay log entry that claims an MCP entry was written. */
function writeMcpReplayEntry(
  sessionId: string,
  providerName: string,
  mcpName: string,
): void {
  appendReplayLog(sessionId, {
    timestamp: new Date().toISOString(),
    stepName: "mcp",
    providerName,
    input: {},
    output: { mcpName },
    status: "completed",
  });
}

/** Write a replay log entry that claims a config entry was written. */
function writeConfigReplayEntry(
  sessionId: string,
  providerName: string,
  serviceName: string,
): void {
  appendReplayLog(sessionId, {
    timestamp: new Date().toISOString(),
    stepName: "config",
    providerName,
    input: {},
    output: { serviceName },
    status: "completed",
  });
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe("rollback-audit", () => {
  let h: Harness;
  let cwd: string;
  let replayDir: string;
  let originalReplayDir: string | undefined;
  let originalCwd: string;

  beforeEach(() => {
    h = setupFakePhantom();
    cwd = makeTmpDir("stack-audit-cwd-");
    replayDir = makeTmpDir("stack-audit-replay-");
    originalReplayDir = process.env.STACK_REPLAY_LOG_DIR;
    process.env.STACK_REPLAY_LOG_DIR = replayDir;
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
    if (originalReplayDir === undefined) {
      delete process.env.STACK_REPLAY_LOG_DIR;
    } else {
      process.env.STACK_REPLAY_LOG_DIR = originalReplayDir;
    }
    try {
      rmSync(replayDir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  // -------------------------------------------------------------------------
  // 1. Successful rollback — all cleaned items absent → verified=true
  // -------------------------------------------------------------------------
  describe("successful rollback (all cleaned)", () => {
    test("reports verified=true when claimed-cleaned secret is absent from vault", async () => {
      const sessionId = generateSessionId("test-provider");
      writeReplaySessionMeta({
        sessionId,
        providerName: "test-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
        finishedAt: new Date().toISOString(),
      });

      // Secret was cleaned — not in vault
      const event = makeRollbackEvent({
        cleaned: [{ kind: "secret", id: "MY_SECRET_KEY" }],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(true);
      expect(report.orphans).toHaveLength(0);
      expect(report.stale).toHaveLength(0);
      expect(report.clean.some((i) => i.id === "MY_SECRET_KEY" && i.status === "verified_clean")).toBe(true);
    });

    test("reports verified=true when claimed-cleaned MCP entry is absent from .mcp.json", async () => {
      const sessionId = generateSessionId("test-provider");
      writeReplaySessionMeta({
        sessionId,
        providerName: "test-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
        finishedAt: new Date().toISOString(),
      });

      // MCP was cleaned — not present in .mcp.json
      await writeMcp(cwd, []); // empty
      const event = makeRollbackEvent({
        cleaned: [{ kind: "mcp_entry", id: "my-mcp-server" }],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(true);
      expect(report.orphans).toHaveLength(0);
      expect(
        report.clean.some((i) => i.id === "my-mcp-server" && i.status === "verified_clean"),
      ).toBe(true);
    });

    test("upstream_resource cleaned → ghost_clean (unverifiable locally)", async () => {
      const sessionId = generateSessionId("test-provider");
      writeReplaySessionMeta({
        sessionId,
        providerName: "test-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({
        cleaned: [{ kind: "upstream_resource", id: "res-upstream-1" }],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      // ghost_clean is still "clean" (no orphan, no stale)
      expect(report.verified).toBe(true);
      expect(report.orphans).toHaveLength(0);
      expect(report.stale).toHaveLength(0);
      const item = report.items.find((i) => i.id === "res-upstream-1");
      expect(item?.status).toBe("ghost_clean");
    });

    test("multiple cleaned items all absent → verified=true", async () => {
      const sessionId = generateSessionId("multi-provider");
      writeReplaySessionMeta({
        sessionId,
        providerName: "multi-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      await writeMcp(cwd, []); // no MCP entries remaining

      const event = makeRollbackEvent({
        providerName: "multi-provider",
        cleaned: [
          { kind: "secret", id: "API_KEY_1" },
          { kind: "secret", id: "API_KEY_2" },
          { kind: "mcp_entry", id: "provider-mcp" },
        ],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(true);
      expect(report.clean).toHaveLength(3);
      expect(report.orphans).toHaveLength(0);
      expect(report.stale).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Partial rollback — some failed items remain → stale, verified=false
  // -------------------------------------------------------------------------
  describe("partial rollback (some failed items remain)", () => {
    test("secret claimed as failed AND still in vault → stale_failed, verified=false", async () => {
      const sessionId = generateSessionId("partial-provider");
      writeReplaySessionMeta({
        sessionId,
        providerName: "partial-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      // Add the secret to the Phantom vault via the harness
      const { vaultPath } = h;
      const vault = { STALE_SECRET: "some-value" };
      writeFileSync(vaultPath, JSON.stringify(vault));

      const event = makeRollbackEvent({
        providerName: "partial-provider",
        cleaned: [],
        failed: [{ kind: "secret", id: "STALE_SECRET", error: "phantom remove failed" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      expect(report.stale).toHaveLength(1);
      expect(report.stale[0]!.id).toBe("STALE_SECRET");
      expect(report.stale[0]!.status).toBe("stale_failed");
    });

    test("MCP entry claimed as failed AND still in .mcp.json → stale_failed", async () => {
      const sessionId = generateSessionId("partial-mcp");
      writeReplaySessionMeta({
        sessionId,
        providerName: "partial-mcp",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      await writeMcp(cwd, ["leftover-mcp-server"]);

      const event = makeRollbackEvent({
        providerName: "partial-mcp",
        cleaned: [],
        failed: [{ kind: "mcp_entry", id: "leftover-mcp-server", error: "write failed" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      expect(report.stale.some((i) => i.id === "leftover-mcp-server")).toBe(true);
    });

    test("upstream_resource in failed list → always stale_failed (no local check)", async () => {
      const sessionId = generateSessionId("upstream-fail");
      writeReplaySessionMeta({
        sessionId,
        providerName: "upstream-fail",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({
        providerName: "upstream-fail",
        cleaned: [],
        failed: [{ kind: "upstream_resource", id: "res-xyz-999", error: "API 503" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      const staleItem = report.stale.find((i) => i.id === "res-xyz-999");
      expect(staleItem).toBeDefined();
      expect(staleItem!.status).toBe("stale_failed");
    });

    test("failed item no longer present (manually removed) → verified_clean", async () => {
      const sessionId = generateSessionId("manual-cleaned");
      writeReplaySessionMeta({
        sessionId,
        providerName: "manual-cleaned",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      // Vault is empty — operator already removed the secret manually
      const event = makeRollbackEvent({
        providerName: "manual-cleaned",
        cleaned: [],
        failed: [{ kind: "secret", id: "ALREADY_GONE", error: "phantom remove failed" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      // verified_clean because the item is gone now (manual cleanup)
      expect(report.verified).toBe(true);
      expect(report.stale).toHaveLength(0);
      const item = report.items.find((i) => i.id === "ALREADY_GONE");
      expect(item?.status).toBe("verified_clean");
    });

    test("mix: some cleaned, some stale → verified=false with correct split", async () => {
      const sessionId = generateSessionId("mix-provider");
      writeReplaySessionMeta({
        sessionId,
        providerName: "mix-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      // Leave one secret stale in vault
      writeFileSync(h.vaultPath, JSON.stringify({ STALE_KEY: "val" }));
      await writeMcp(cwd, []); // MCP cleaned

      const event = makeRollbackEvent({
        providerName: "mix-provider",
        cleaned: [
          { kind: "mcp_entry", id: "mix-mcp" },
          { kind: "secret", id: "CLEANED_KEY" },
        ],
        failed: [{ kind: "secret", id: "STALE_KEY", error: "phantom error" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      expect(report.clean.some((i) => i.id === "mix-mcp" && i.status === "verified_clean")).toBe(true);
      expect(report.clean.some((i) => i.id === "CLEANED_KEY" && i.status === "verified_clean")).toBe(true);
      expect(report.stale.some((i) => i.id === "STALE_KEY" && i.status === "stale_failed")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Orphaned state — present in filesystem but not in rollback event
  // -------------------------------------------------------------------------
  describe("orphaned state (secrets in vault not in replay log)", () => {
    test("secret in vault that was written per replay log but not in rollback event → orphan_secret", async () => {
      const sessionId = generateSessionId("orphan-test");
      writeReplaySessionMeta({
        sessionId,
        providerName: "orphan-test",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      // Write replay log claiming SECRET_ORPHAN was written
      writeSecretsReplayEntry(sessionId, "orphan-test", ["SECRET_ORPHAN"]);

      // Add secret to vault (orphaned — rollback event doesn't mention it)
      writeFileSync(h.vaultPath, JSON.stringify({ SECRET_ORPHAN: "val" }));

      // Rollback event mentions no items
      const event = makeRollbackEvent({
        providerName: "orphan-test",
        cleaned: [],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      expect(report.orphans).toHaveLength(1);
      expect(report.orphans[0]!.id).toBe("SECRET_ORPHAN");
      expect(report.orphans[0]!.status).toBe("orphan_secret");
    });

    test("MCP entry in .mcp.json per replay log but not in rollback event → orphan_mcp", async () => {
      const sessionId = generateSessionId("orphan-mcp");
      writeReplaySessionMeta({
        sessionId,
        providerName: "orphan-mcp",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      writeMcpReplayEntry(sessionId, "orphan-mcp", "orphaned-server");
      await writeMcp(cwd, ["orphaned-server"]);

      const event = makeRollbackEvent({
        providerName: "orphan-mcp",
        cleaned: [],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      expect(report.orphans.some((o) => o.id === "orphaned-server" && o.status === "orphan_mcp")).toBe(true);
    });

    test("config entry in .stack.toml per replay log but not in rollback event → orphan_config", async () => {
      const sessionId = generateSessionId("orphan-config");
      writeReplaySessionMeta({
        sessionId,
        providerName: "orphan-config",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      writeConfigReplayEntry(sessionId, "orphan-config", "orphan-config");
      await writeStackToml(cwd, ["orphan-config"]);

      const event = makeRollbackEvent({
        providerName: "orphan-config",
        cleaned: [],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      expect(
        report.orphans.some((o) => o.id === "orphan-config" && o.status === "orphan_config"),
      ).toBe(true);
    });

    test("secret written per replay log but already absent from vault → not flagged as orphan", async () => {
      const sessionId = generateSessionId("already-gone");
      writeReplaySessionMeta({
        sessionId,
        providerName: "already-gone",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      // Replay log says SECRET_GONE was written, but vault is now empty
      writeSecretsReplayEntry(sessionId, "already-gone", ["SECRET_GONE"]);
      // vault is empty (default in harness)

      const event = makeRollbackEvent({
        providerName: "already-gone",
        cleaned: [],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      // No orphan because the secret is gone from vault (was cleaned elsewhere or never written)
      expect(report.orphans.filter((o) => o.id === "SECRET_GONE")).toHaveLength(0);
    });

    test("claimed-cleaned secret still present → reclassified as orphan_secret", async () => {
      const sessionId = generateSessionId("liar-rollback");
      writeReplaySessionMeta({
        sessionId,
        providerName: "liar-rollback",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      // Rollback event claims it cleaned LIAR_KEY, but the key is still in vault
      writeFileSync(h.vaultPath, JSON.stringify({ LIAR_KEY: "still-here" }));

      const event = makeRollbackEvent({
        providerName: "liar-rollback",
        cleaned: [{ kind: "secret", id: "LIAR_KEY" }],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);
      expect(report.orphans.some((o) => o.id === "LIAR_KEY" && o.status === "orphan_secret")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Cascade failures — cleanup of cleanup
  // -------------------------------------------------------------------------
  describe("cascade failures (cleanup of cleanup)", () => {
    test("rollback event with no cleaned or failed items and no replay log writes → verified=true (nothing to check)", async () => {
      const sessionId = generateSessionId("empty-session");
      writeReplaySessionMeta({
        sessionId,
        providerName: "empty-session",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({
        providerName: "empty-session",
        cleaned: [],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(true);
      expect(report.orphans).toHaveLength(0);
      expect(report.stale).toHaveLength(0);
      expect(report.items).toHaveLength(0);
    });

    test("upstream_resource always ghost_clean even when in cleaned list — local verification impossible", async () => {
      const sessionId = generateSessionId("upstream-clean");
      writeReplaySessionMeta({
        sessionId,
        providerName: "upstream-clean",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({
        cleaned: [
          { kind: "upstream_resource", id: "proj-abc" },
          { kind: "upstream_resource", id: "proj-def" },
        ],
        failed: [],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(true);
      expect(report.items).toHaveLength(2);
      expect(report.items.every((i) => i.status === "ghost_clean")).toBe(true);
    });

    test("interleaved clean + stale + orphan items all present simultaneously", async () => {
      const sessionId = generateSessionId("cascade");
      writeReplaySessionMeta({
        sessionId,
        providerName: "cascade-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      // Vault has STALE_KEY (failed cleanup) and ORPHAN_KEY (not in rollback)
      writeFileSync(h.vaultPath, JSON.stringify({ STALE_KEY: "v", ORPHAN_KEY: "v" }));
      await writeMcp(cwd, ["orphan-mcp"]); // orphaned MCP
      // CLEANED_KEY absent from vault ✓

      // Replay log: ORPHAN_KEY and orphan-mcp were written during provision
      writeSecretsReplayEntry(sessionId, "cascade-provider", ["STALE_KEY", "ORPHAN_KEY", "CLEANED_KEY"]);
      writeMcpReplayEntry(sessionId, "cascade-provider", "orphan-mcp");

      const event = makeRollbackEvent({
        providerName: "cascade-provider",
        cleaned: [{ kind: "secret", id: "CLEANED_KEY" }],
        failed: [{ kind: "secret", id: "STALE_KEY", error: "phantom failed" }],
        // ORPHAN_KEY and orphan-mcp are intentionally absent from event
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.verified).toBe(false);

      // CLEANED_KEY is clean
      expect(report.clean.some((i) => i.id === "CLEANED_KEY" && i.status === "verified_clean")).toBe(true);
      // STALE_KEY is stale
      expect(report.stale.some((i) => i.id === "STALE_KEY" && i.status === "stale_failed")).toBe(true);
      // ORPHAN_KEY is orphan
      expect(report.orphans.some((o) => o.id === "ORPHAN_KEY" && o.status === "orphan_secret")).toBe(true);
      // orphan-mcp is orphan
      expect(report.orphans.some((o) => o.id === "orphan-mcp" && o.status === "orphan_mcp")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. No rollback event (audit from replay log alone)
  // -------------------------------------------------------------------------
  describe("audit from replay log alone (no rollback event)", () => {
    test("orphaned secret detected without rollback event when secret present in vault", async () => {
      const sessionId = generateSessionId("no-event");
      writeReplaySessionMeta({
        sessionId,
        providerName: "no-event-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      writeSecretsReplayEntry(sessionId, "no-event-provider", ["ORPHAN_NO_EVENT"]);
      writeFileSync(h.vaultPath, JSON.stringify({ ORPHAN_NO_EVENT: "val" }));

      // No rollbackEvent passed
      const report = await auditRollback(sessionId, { cwd });

      expect(report.verified).toBe(false);
      expect(report.orphans.some((o) => o.id === "ORPHAN_NO_EVENT")).toBe(true);
    });

    test("no replay log entries and no rollback event → empty items, verified=true", async () => {
      const sessionId = generateSessionId("truly-empty");
      writeReplaySessionMeta({
        sessionId,
        providerName: "truly-empty",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const report = await auditRollback(sessionId, { cwd });

      expect(report.verified).toBe(true);
      expect(report.items).toHaveLength(0);
      expect(report.orphans).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. formatAuditReport
  // -------------------------------------------------------------------------
  describe("formatAuditReport output", () => {
    test("verified report includes checkmark line", async () => {
      const sessionId = generateSessionId("fmt-clean");
      writeReplaySessionMeta({
        sessionId,
        providerName: "fmt-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({ providerName: "fmt-provider", cleaned: [], failed: [] });
      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      const text = formatAuditReport(report);
      expect(text).toContain("verified clean");
      expect(text).toContain(sessionId);
      expect(text).toContain("fmt-provider");
    });

    test("dirty report includes orphan and stale sections", async () => {
      const sessionId = generateSessionId("fmt-dirty");
      writeReplaySessionMeta({
        sessionId,
        providerName: "fmt-dirty",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      writeFileSync(h.vaultPath, JSON.stringify({ DIRTY_SECRET: "val" }));
      writeSecretsReplayEntry(sessionId, "fmt-dirty", ["DIRTY_SECRET"]);

      const event = makeRollbackEvent({
        providerName: "fmt-dirty",
        cleaned: [],
        failed: [{ kind: "upstream_resource", id: "res-dirty", error: "err" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });
      const text = formatAuditReport(report);

      expect(text).toContain("Orphans");
      expect(text).toContain("DIRTY_SECRET");
      expect(text).toContain("Stale");
      expect(text).toContain("res-dirty");
      expect(text).toContain("Recommendations");
    });

    test("recommendations include urgent entries for orphaned secrets", async () => {
      const sessionId = generateSessionId("fmt-recs");
      writeReplaySessionMeta({
        sessionId,
        providerName: "fmt-recs-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      writeFileSync(h.vaultPath, JSON.stringify({ REC_SECRET: "val" }));
      writeSecretsReplayEntry(sessionId, "fmt-recs-provider", ["REC_SECRET"]);

      const event = makeRollbackEvent({ providerName: "fmt-recs-provider", cleaned: [], failed: [] });
      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.recommendations.some((r) => r.urgent && r.command.includes("REC_SECRET"))).toBe(true);

      const text = formatAuditReport(report);
      expect(text).toContain("phantom remove REC_SECRET");
      expect(text).toContain("[URGENT]");
    });
  });

  // -------------------------------------------------------------------------
  // 7. Unknown / missing session → graceful empty report
  // -------------------------------------------------------------------------
  describe("missing or unknown session", () => {
    test("unknown sessionId returns empty report with providerName=unknown", async () => {
      const report = await auditRollback("nonexistent-session-id-xyz", { cwd });

      expect(report.sessionId).toBe("nonexistent-session-id-xyz");
      expect(report.providerName).toBe("unknown");
      expect(report.verified).toBe(true);
      expect(report.items).toHaveLength(0);
      expect(report.orphans).toHaveLength(0);
      expect(report.stale).toHaveLength(0);
    });

    test("rollbackEvent providerName used when session meta not found", async () => {
      const event = makeRollbackEvent({ providerName: "fallback-provider" });
      const report = await auditRollback("no-meta-session", { cwd, rollbackEvent: event });

      expect(report.providerName).toBe("fallback-provider");
    });
  });

  // -------------------------------------------------------------------------
  // 8. Recommendations shape
  // -------------------------------------------------------------------------
  describe("recommendations", () => {
    test("no recommendations when verified=true", async () => {
      const sessionId = generateSessionId("no-recs");
      writeReplaySessionMeta({
        sessionId,
        providerName: "no-recs",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({ cleaned: [], failed: [] });
      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.recommendations).toHaveLength(0);
    });

    test("stale upstream resource produces dashboard recommendation", async () => {
      const sessionId = generateSessionId("upstream-recs");
      writeReplaySessionMeta({
        sessionId,
        providerName: "stripe",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({
        providerName: "stripe",
        cleaned: [],
        failed: [{ kind: "upstream_resource", id: "acct_123", error: "API 503" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      const dashboardRec = report.recommendations.find((r) =>
        r.command.includes("stack open stripe"),
      );
      expect(dashboardRec).toBeDefined();
      expect(dashboardRec!.urgent).toBe(true);
    });

    test("recovery suggestion from rollback event is surfaced as non-urgent recommendation", async () => {
      const sessionId = generateSessionId("suggestion-recs");
      writeReplaySessionMeta({
        sessionId,
        providerName: "neon",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const event = makeRollbackEvent({
        providerName: "neon",
        cleaned: [],
        failed: [{ kind: "upstream_resource", id: "proj-abc", error: "timeout" }],
        recoverySuggestion: "Delete proj-abc manually on the Neon dashboard.",
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      const suggestionRec = report.recommendations.find(
        (r) => r.command.includes("Delete proj-abc"),
      );
      expect(suggestionRec).toBeDefined();
      expect(suggestionRec!.urgent).toBe(false);
    });

    test("doctor --audit recommendation appended when there are any issues", async () => {
      const sessionId = generateSessionId("doctor-recs");
      writeReplaySessionMeta({
        sessionId,
        providerName: "vercel",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      writeFileSync(h.vaultPath, JSON.stringify({ VERCEL_TOKEN: "tok" }));
      writeSecretsReplayEntry(sessionId, "vercel", ["VERCEL_TOKEN"]);

      const event = makeRollbackEvent({ providerName: "vercel", cleaned: [], failed: [] });
      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      expect(report.recommendations.some((r) => r.command.includes("stack doctor --audit"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Audit report shape invariants
  // -------------------------------------------------------------------------
  describe("report shape invariants", () => {
    test("items is the union of clean + orphans + stale", async () => {
      const sessionId = generateSessionId("invariant");
      writeReplaySessionMeta({
        sessionId,
        providerName: "invariant-provider",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      writeFileSync(h.vaultPath, JSON.stringify({ STALE: "v", ORPHAN: "v" }));
      writeSecretsReplayEntry(sessionId, "invariant-provider", ["ORPHAN", "CLEANED"]);

      const event = makeRollbackEvent({
        providerName: "invariant-provider",
        cleaned: [{ kind: "secret", id: "CLEANED" }],
        failed: [{ kind: "secret", id: "STALE", error: "err" }],
      });

      const report = await auditRollback(sessionId, { cwd, rollbackEvent: event });

      const allIds = new Set(report.items.map((i) => i.id));
      for (const item of [...report.clean, ...report.orphans, ...report.stale]) {
        expect(allIds.has(item.id)).toBe(true);
      }

      expect(report.items.length).toBeGreaterThanOrEqual(
        report.clean.length + report.orphans.length + report.stale.length,
      );
    });

    test("report auditedAt is a valid ISO timestamp", async () => {
      const sessionId = generateSessionId("iso-ts");
      writeReplaySessionMeta({
        sessionId,
        providerName: "iso-ts",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const report = await auditRollback(sessionId, { cwd });
      expect(() => new Date(report.auditedAt)).not.toThrow();
      expect(new Date(report.auditedAt).toISOString()).toBe(report.auditedAt);
    });

    test("errors array is present even on clean audits", async () => {
      const sessionId = generateSessionId("errors-array");
      writeReplaySessionMeta({
        sessionId,
        providerName: "errors-array",
        cwd,
        startedAt: new Date().toISOString(),
        finalStatus: "failed",
      });

      const report = await auditRollback(sessionId, { cwd });
      expect(Array.isArray(report.errors)).toBe(true);
    });
  });
});
