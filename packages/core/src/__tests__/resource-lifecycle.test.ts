/**
 * Resource Lifecycle Registry — comprehensive test suite.
 *
 * Covers:
 *  1.  CRUD: get / set / delete / services()
 *  2.  seedFromService factory
 *  3.  computeDrift: ok, deleted, degraded (region), degraded (tier), stale, unknown
 *  4.  reconcileOne: no probe, probe returning alive, probe returning deleted,
 *      probe returning region drift, apply patching, probe error handling
 *  5.  reconcileAll: multi-resource, summary counts, apply persists to disk
 *  6.  Persistence: readLocalLifecycle / writeLocalLifecycle round-trip,
 *      merges with existing toml keys, handles missing file
 *  7.  Provider-side deletion scenario
 *  8.  Region / tier downgrade scenarios
 *  9.  Multi-resource conflict scenarios
 * 10.  Stale threshold edge cases
 * 11.  save() flushes to disk
 * 12.  ResourceLifecycle.load() from disk
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { LOCAL_FILENAME } from "../config.ts";
import {
  DEFAULT_STALE_THRESHOLD_MS,
  ResourceLifecycle,
  readLocalLifecycle,
  writeLocalLifecycle,
  type LiveProbe,
  type LiveProbeMap,
  type ResourceLifecycleMeta,
} from "../resource-lifecycle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "stack-lifecycle-"));
}

function freshMeta(overrides: Partial<ResourceLifecycleMeta> = {}): ResourceLifecycleMeta {
  return {
    resource_id: "res_abc123",
    provider: "supabase",
    created_at: "2026-01-01T00:00:00Z",
    last_verified_at: new Date().toISOString(),
    region: "us-east-1",
    tier: "free",
    ...overrides,
  };
}

/** Returns an ISO timestamp `daysAgo` days in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const ALIVE_PROBE: LiveProbe = async () => ({ alive: true });
const DELETED_PROBE: LiveProbe = async () => ({ alive: false });

function regionChangedProbe(newRegion: string): LiveProbe {
  return async () => ({ alive: true, region: newRegion });
}

function tierChangedProbe(newTier: string): LiveProbe {
  return async () => ({ alive: true, tier: newTier });
}

function throwingProbe(msg: string): LiveProbe {
  return async () => {
    throw new Error(msg);
  };
}

// ---------------------------------------------------------------------------
// 1. CRUD
// ---------------------------------------------------------------------------

describe("ResourceLifecycle — CRUD", () => {
  test("get() returns undefined for unknown service", () => {
    const registry = new ResourceLifecycle({});
    expect(registry.get("nope")).toBeUndefined();
  });

  test("set() then get() round-trips metadata", () => {
    const registry = new ResourceLifecycle({});
    const meta = freshMeta();
    registry.set("supabase", meta);
    expect(registry.get("supabase")).toEqual(meta);
  });

  test("set() stores a copy — mutation of original does not affect registry", () => {
    const registry = new ResourceLifecycle({});
    const meta = freshMeta();
    registry.set("supabase", meta);
    meta.region = "eu-west-1";
    expect(registry.get("supabase")?.region).toBe("us-east-1");
  });

  test("delete() removes a service", () => {
    const registry = new ResourceLifecycle({ supabase: freshMeta() });
    registry.delete("supabase");
    expect(registry.get("supabase")).toBeUndefined();
    expect(registry.services()).not.toContain("supabase");
  });

  test("delete() on non-existent key is a no-op", () => {
    const registry = new ResourceLifecycle({});
    expect(() => registry.delete("nonexistent")).not.toThrow();
  });

  test("services() returns all tracked service names", () => {
    const registry = new ResourceLifecycle({
      supabase: freshMeta({ provider: "supabase" }),
      vercel: freshMeta({ provider: "vercel", resource_id: "prj_xyz" }),
    });
    expect(registry.services().sort()).toEqual(["supabase", "vercel"]);
  });

  test("services() returns empty array when no services tracked", () => {
    const registry = new ResourceLifecycle({});
    expect(registry.services()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. seedFromService factory
// ---------------------------------------------------------------------------

describe("ResourceLifecycle.seedFromService", () => {
  test("creates a record with last_verified_at set to now", () => {
    const before = Date.now();
    const meta = ResourceLifecycle.seedFromService("supabase", {
      resource_id: "ref_123",
      provider: "supabase",
      region: "us-east-1",
      tier: "pro",
    });
    const after = Date.now();
    const lv = new Date(meta.last_verified_at).getTime();
    expect(lv).toBeGreaterThanOrEqual(before);
    expect(lv).toBeLessThanOrEqual(after);
  });

  test("uses provided created_at when supplied", () => {
    const meta = ResourceLifecycle.seedFromService("vercel", {
      resource_id: "prj_abc",
      provider: "vercel",
      created_at: "2025-06-01T00:00:00Z",
    });
    expect(meta.created_at).toBe("2025-06-01T00:00:00Z");
  });

  test("falls back to now for created_at when not supplied", () => {
    const before = Date.now();
    const meta = ResourceLifecycle.seedFromService("neon", {
      resource_id: "proj_neon",
      provider: "neon",
    });
    expect(new Date(meta.created_at).getTime()).toBeGreaterThanOrEqual(before);
  });

  test("optional region/tier/meta are omitted when not provided", () => {
    const meta = ResourceLifecycle.seedFromService("stripe", {
      resource_id: "acct_abc",
      provider: "stripe",
    });
    expect(meta.region).toBeUndefined();
    expect(meta.tier).toBeUndefined();
    expect(meta.meta).toBeUndefined();
  });

  test("meta is included when provided", () => {
    const meta = ResourceLifecycle.seedFromService("github", {
      resource_id: "repo_123",
      provider: "github",
      meta: { org: "acme", private: true },
    });
    expect(meta.meta).toEqual({ org: "acme", private: true });
  });
});

// ---------------------------------------------------------------------------
// 3. computeDrift — pure local checks
// ---------------------------------------------------------------------------

describe("ResourceLifecycle — computeDrift", () => {
  test("ok: recently verified, live confirms alive, no field changes", () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const drift = registry.computeDrift("svc", { live: { alive: true } });
    expect(drift.kind).toBe("ok");
  });

  test("ok: no live snapshot, recently verified", () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const drift = registry.computeDrift("svc");
    expect(drift.kind).toBe("ok");
  });

  test("unknown: service not in registry", () => {
    const registry = new ResourceLifecycle({});
    const drift = registry.computeDrift("ghost");
    expect(drift.kind).toBe("unknown");
    expect(drift.detail).toMatch(/ghost/);
  });

  test("deleted: live.alive === false", () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const drift = registry.computeDrift("svc", { live: { alive: false } });
    expect(drift.kind).toBe("deleted");
    expect(drift.detail).toMatch(/res_abc123/);
    expect(drift.local.resource_id).toBe("res_abc123");
  });

  test("degraded: region changed", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ region: "us-east-1" }),
    });
    const drift = registry.computeDrift("svc", {
      live: { alive: true, region: "eu-west-1" },
    });
    expect(drift.kind).toBe("degraded");
    expect(drift.detail).toMatch(/us-east-1/);
    expect(drift.detail).toMatch(/eu-west-1/);
  });

  test("degraded: tier changed", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ tier: "pro" }),
    });
    const drift = registry.computeDrift("svc", {
      live: { alive: true, tier: "free" },
    });
    expect(drift.kind).toBe("degraded");
    expect(drift.detail).toMatch(/pro/);
    expect(drift.detail).toMatch(/free/);
  });

  test("degraded: both region and tier changed", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ region: "us-east-1", tier: "pro" }),
    });
    const drift = registry.computeDrift("svc", {
      live: { alive: true, region: "ap-southeast-1", tier: "free" },
    });
    expect(drift.kind).toBe("degraded");
    expect(drift.detail).toMatch(/region/);
    expect(drift.detail).toMatch(/tier/);
  });

  test("stale: last_verified_at older than threshold", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ last_verified_at: daysAgo(8) }),
    });
    const drift = registry.computeDrift("svc", {
      staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    });
    expect(drift.kind).toBe("stale");
    expect(drift.detail).toMatch(/8 day/);
  });

  test("ok: last_verified_at just within threshold", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ last_verified_at: daysAgo(6) }),
    });
    const drift = registry.computeDrift("svc", {
      staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    });
    expect(drift.kind).toBe("ok");
  });

  test("custom staleThresholdMs is respected", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ last_verified_at: daysAgo(1) }),
    });
    // 1-hour threshold → 1 day old is stale
    const drift = registry.computeDrift("svc", { staleThresholdMs: 60 * 60 * 1000 });
    expect(drift.kind).toBe("stale");
  });

  test("deleted takes priority over stale", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ last_verified_at: daysAgo(30) }),
    });
    const drift = registry.computeDrift("svc", {
      live: { alive: false },
      staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    });
    expect(drift.kind).toBe("deleted");
  });

  test("degraded takes priority over stale", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ last_verified_at: daysAgo(30), region: "us-east-1" }),
    });
    const drift = registry.computeDrift("svc", {
      live: { alive: true, region: "eu-west-1" },
      staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    });
    expect(drift.kind).toBe("degraded");
  });
});

// ---------------------------------------------------------------------------
// 4. reconcileOne
// ---------------------------------------------------------------------------

describe("ResourceLifecycle — reconcileOne", () => {
  test("no probe registered → drift is computed from local state only", async () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const result = await registry.reconcileOne("svc");
    expect(result.service).toBe("svc");
    expect(result.drift.kind).toBe("ok");
    expect(result.patched).toBe(false);
  });

  test("probe returning alive → ok, no patch without apply", async () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const probes: LiveProbeMap = { supabase: ALIVE_PROBE };
    const result = await registry.reconcileOne("svc", { liveProbes: probes });
    expect(result.drift.kind).toBe("ok");
    expect(result.patched).toBe(false);
  });

  test("probe returning deleted → deleted drift", async () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const probes: LiveProbeMap = { supabase: DELETED_PROBE };
    const result = await registry.reconcileOne("svc", { liveProbes: probes });
    expect(result.drift.kind).toBe("deleted");
  });

  test("probe returning region change → degraded drift", async () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ region: "us-east-1" }),
    });
    const probes: LiveProbeMap = { supabase: regionChangedProbe("eu-central-1") };
    const result = await registry.reconcileOne("svc", { liveProbes: probes });
    expect(result.drift.kind).toBe("degraded");
  });

  test("apply=true patches region drift and bumps last_verified_at", async () => {
    const oldTs = daysAgo(1);
    const registry = new ResourceLifecycle({
      svc: freshMeta({ region: "us-east-1", last_verified_at: oldTs }),
    });
    const probes: LiveProbeMap = { supabase: regionChangedProbe("eu-central-1") };
    const result = await registry.reconcileOne("svc", {
      liveProbes: probes,
      apply: true,
    });
    expect(result.patched).toBe(true);
    expect(registry.get("svc")?.region).toBe("eu-central-1");
    // last_verified_at should be bumped
    expect(registry.get("svc")?.last_verified_at).not.toBe(oldTs);
  });

  test("apply=true patches tier drift", async () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ tier: "pro" }),
    });
    const probes: LiveProbeMap = { supabase: tierChangedProbe("free") };
    const result = await registry.reconcileOne("svc", {
      liveProbes: probes,
      apply: true,
    });
    expect(result.patched).toBe(true);
    expect(registry.get("svc")?.tier).toBe("free");
  });

  test("apply=true does NOT patch deleted resources", async () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const probes: LiveProbeMap = { supabase: DELETED_PROBE };
    const result = await registry.reconcileOne("svc", {
      liveProbes: probes,
      apply: true,
    });
    expect(result.drift.kind).toBe("deleted");
    expect(result.patched).toBe(false);
  });

  test("probe throwing error → error field set, drift treated as ok/alive", async () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const probes: LiveProbeMap = { supabase: throwingProbe("network timeout") };
    const result = await registry.reconcileOne("svc", { liveProbes: probes });
    expect(result.error).toBe("network timeout");
    // When probe throws we assume alive to avoid false deletions
    expect(result.drift.kind).not.toBe("deleted");
  });

  test("reconcileOne for unknown service returns unknown drift", async () => {
    const registry = new ResourceLifecycle({});
    const result = await registry.reconcileOne("ghost");
    expect(result.drift.kind).toBe("unknown");
    expect(result.patched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. reconcileAll — multi-resource
// ---------------------------------------------------------------------------

describe("ResourceLifecycle — reconcileAll", () => {
  test("returns correct summary counts for mixed results", async () => {
    const registry = new ResourceLifecycle({
      svc_ok: freshMeta({ provider: "vercel", resource_id: "prj_ok" }),
      svc_deleted: freshMeta({ provider: "supabase", resource_id: "ref_del" }),
      svc_stale: freshMeta({
        provider: "neon",
        resource_id: "proj_stale",
        last_verified_at: daysAgo(10),
      }),
    });

    const probes: LiveProbeMap = {
      vercel: ALIVE_PROBE,
      supabase: DELETED_PROBE,
      // neon has no probe → stale detected from timestamp
    };

    const summary = await registry.reconcileAll({ liveProbes: probes });
    expect(summary.total).toBe(3);
    expect(summary.results.find((r) => r.service === "svc_ok")?.drift.kind).toBe("ok");
    expect(summary.results.find((r) => r.service === "svc_deleted")?.drift.kind).toBe("deleted");
    expect(summary.results.find((r) => r.service === "svc_stale")?.drift.kind).toBe("stale");
  });

  test("reconciledAt is a valid ISO timestamp", async () => {
    const registry = new ResourceLifecycle({ svc: freshMeta() });
    const summary = await registry.reconcileAll();
    expect(() => new Date(summary.reconciledAt)).not.toThrow();
    expect(new Date(summary.reconciledAt).getTime()).toBeGreaterThan(0);
  });

  test("empty registry returns zero-count summary", async () => {
    const registry = new ResourceLifecycle({});
    const summary = await registry.reconcileAll();
    expect(summary.total).toBe(0);
    expect(summary.ok).toBe(0);
    expect(summary.patched).toBe(0);
    expect(summary.results).toEqual([]);
  });

  test("apply=true flushes patches to disk", async () => {
    const cwd = makeTmpDir();
    try {
      const registry = new ResourceLifecycle(
        {
          svc: freshMeta({ region: "us-east-1", provider: "vercel" }),
        },
        cwd,
      );

      const probes: LiveProbeMap = { vercel: regionChangedProbe("eu-west-1") };
      const summary = await registry.reconcileAll({ liveProbes: probes, apply: true });

      expect(summary.patched).toBe(1);

      // Verify the change was persisted to disk
      const reloaded = await ResourceLifecycle.load(cwd);
      expect(reloaded.get("svc")?.region).toBe("eu-west-1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("ok count matches number of ok results", async () => {
    const registry = new ResourceLifecycle({
      a: freshMeta({ provider: "vercel", resource_id: "a" }),
      b: freshMeta({ provider: "stripe", resource_id: "b" }),
    });
    const probes: LiveProbeMap = {
      vercel: ALIVE_PROBE,
      stripe: ALIVE_PROBE,
    };
    const summary = await registry.reconcileAll({ liveProbes: probes });
    expect(summary.ok).toBe(2);
    expect(summary.patched).toBe(0);
    expect(summary.failed).toBe(0);
  });

  test("failed count reflects probe errors", async () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ provider: "neon" }),
    });
    const probes: LiveProbeMap = { neon: throwingProbe("DNS failure") };
    const summary = await registry.reconcileAll({ liveProbes: probes });
    expect(summary.failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Persistence — readLocalLifecycle / writeLocalLifecycle
// ---------------------------------------------------------------------------

describe("Persistence — readLocalLifecycle / writeLocalLifecycle", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("returns empty object when .stack.local.toml does not exist", async () => {
    const store = await readLocalLifecycle(cwd);
    expect(store).toEqual({});
  });

  test("round-trips a lifecycle store", async () => {
    const meta = freshMeta();
    await writeLocalLifecycle({ supabase: meta }, cwd);
    const store = await readLocalLifecycle(cwd);
    expect(store.supabase).toEqual(meta);
  });

  test("preserves existing toml keys when writing lifecycle section", async () => {
    // Write a local toml with stack.project_id
    const localPath = join(cwd, LOCAL_FILENAME);
    writeFileSync(
      localPath,
      `# Ashlr Stack — local instance data. Auto-generated; do not commit.\n[stack]\nproject_id = "stk_aabbcc"\n`,
    );

    await writeLocalLifecycle({ svc: freshMeta() }, cwd);

    const raw = parseToml(await readFile(localPath, "utf-8")) as Record<string, unknown>;
    expect((raw.stack as Record<string, unknown>).project_id).toBe("stk_aabbcc");
    expect(raw.lifecycle).toBeDefined();
  });

  test("multiple services round-trip correctly", async () => {
    const store = {
      svc_a: freshMeta({ provider: "vercel", resource_id: "prj_a" }),
      svc_b: freshMeta({ provider: "neon", resource_id: "proj_b" }),
    };
    await writeLocalLifecycle(store, cwd);
    const loaded = await readLocalLifecycle(cwd);
    expect(loaded.svc_a.provider).toBe("vercel");
    expect(loaded.svc_b.provider).toBe("neon");
  });

  test("returns empty object when lifecycle section is absent", async () => {
    const localPath = join(cwd, LOCAL_FILENAME);
    writeFileSync(localPath, `[stack]\nproject_id = "stk_xyz"\n`);
    const store = await readLocalLifecycle(cwd);
    expect(store).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 7. Provider-side deletion scenario (end-to-end)
// ---------------------------------------------------------------------------

describe("Scenario — provider-side deletion", () => {
  test("detects deletion and does not patch when apply=false", async () => {
    const registry = new ResourceLifecycle({
      db: freshMeta({ provider: "supabase", resource_id: "ref_gone" }),
    });
    const probes: LiveProbeMap = { supabase: DELETED_PROBE };
    const result = await registry.reconcileOne("db", { liveProbes: probes });
    expect(result.drift.kind).toBe("deleted");
    expect(result.patched).toBe(false);
    // Record should NOT be removed automatically
    expect(registry.get("db")).toBeDefined();
  });

  test("deletion reported correctly in reconcileAll summary", async () => {
    const registry = new ResourceLifecycle({
      db: freshMeta({ provider: "supabase", resource_id: "ref_gone" }),
      cache: freshMeta({ provider: "upstash", resource_id: "db_ok" }),
    });
    const probes: LiveProbeMap = {
      supabase: DELETED_PROBE,
      upstash: ALIVE_PROBE,
    };
    const summary = await registry.reconcileAll({ liveProbes: probes });
    const deleted = summary.results.find((r) => r.service === "db");
    const ok = summary.results.find((r) => r.service === "cache");
    expect(deleted?.drift.kind).toBe("deleted");
    expect(ok?.drift.kind).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 8. Region / tier downgrade scenarios
// ---------------------------------------------------------------------------

describe("Scenario — region/tier downgrade", () => {
  test("region downgrade detected and patched with apply=true", async () => {
    const cwd = makeTmpDir();
    try {
      const registry = new ResourceLifecycle(
        { api: freshMeta({ provider: "render", resource_id: "svc_1", region: "ohio" }) },
        cwd,
      );
      const probes: LiveProbeMap = { render: regionChangedProbe("frankfurt") };
      const result = await registry.reconcileOne("api", { liveProbes: probes, apply: true });
      expect(result.drift.kind).toBe("degraded");
      expect(result.patched).toBe(true);
      expect(registry.get("api")?.region).toBe("frankfurt");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("tier downgrade (pro→free) detected", async () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ provider: "railway", resource_id: "proj_r", tier: "pro" }),
    });
    const probes: LiveProbeMap = { railway: tierChangedProbe("free") };
    const result = await registry.reconcileOne("svc", { liveProbes: probes });
    expect(result.drift.kind).toBe("degraded");
    expect(result.drift.detail).toMatch(/tier/);
  });

  test("region upgrade (same provider, different region) also detected as degraded", async () => {
    // Any region mismatch counts as drift, not just downgrades
    const registry = new ResourceLifecycle({
      svc: freshMeta({ provider: "fly", resource_id: "app_fly", region: "iad" }),
    });
    const probes: LiveProbeMap = { fly: regionChangedProbe("lhr") };
    const result = await registry.reconcileOne("svc", { liveProbes: probes });
    expect(result.drift.kind).toBe("degraded");
  });

  test("no drift when region matches", async () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ provider: "fly", resource_id: "app_fly", region: "iad" }),
    });
    const probes: LiveProbeMap = { fly: async () => ({ alive: true, region: "iad" }) };
    const result = await registry.reconcileOne("svc", { liveProbes: probes });
    expect(result.drift.kind).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 9. Multi-resource conflict scenarios
// ---------------------------------------------------------------------------

describe("Scenario — multi-resource conflicts", () => {
  test("two services sharing a provider both reconcile independently", async () => {
    const registry = new ResourceLifecycle({
      db_prod: freshMeta({ provider: "neon", resource_id: "proj_prod" }),
      db_staging: freshMeta({
        provider: "neon",
        resource_id: "proj_staging",
        last_verified_at: daysAgo(10),
      }),
    });

    const probes: LiveProbeMap = { neon: ALIVE_PROBE };
    const summary = await registry.reconcileAll({ liveProbes: probes });
    expect(summary.total).toBe(2);

    const prod = summary.results.find((r) => r.service === "db_prod");
    const staging = summary.results.find((r) => r.service === "db_staging");
    expect(prod?.drift.kind).toBe("ok");
    // staging is stale but alive probe bumps it after apply; without apply it remains stale
    // (no apply here, stale check depends on last_verified_at not being bumped)
    expect(staging?.drift.kind).toBe("stale");
  });

  test("probe error on one resource does not affect others", async () => {
    const registry = new ResourceLifecycle({
      a: freshMeta({ provider: "vercel", resource_id: "prj_a" }),
      b: freshMeta({ provider: "stripe", resource_id: "acct_b" }),
    });
    const probes: LiveProbeMap = {
      vercel: throwingProbe("timeout"),
      stripe: ALIVE_PROBE,
    };
    const summary = await registry.reconcileAll({ liveProbes: probes });
    const resultA = summary.results.find((r) => r.service === "a");
    const resultB = summary.results.find((r) => r.service === "b");
    expect(resultA?.error).toBe("timeout");
    expect(resultB?.drift.kind).toBe("ok");
    expect(resultB?.error).toBeUndefined();
  });

  test("all services deleted simultaneously", async () => {
    const registry = new ResourceLifecycle({
      a: freshMeta({ provider: "supabase", resource_id: "ref_a" }),
      b: freshMeta({ provider: "supabase", resource_id: "ref_b" }),
      c: freshMeta({ provider: "supabase", resource_id: "ref_c" }),
    });
    const probes: LiveProbeMap = { supabase: DELETED_PROBE };
    const summary = await registry.reconcileAll({ liveProbes: probes });
    expect(summary.results.every((r) => r.drift.kind === "deleted")).toBe(true);
    expect(summary.ok).toBe(0);
  });

  test("mixed ok, deleted, stale, degraded", async () => {
    const registry = new ResourceLifecycle({
      ok_svc: freshMeta({ provider: "vercel", resource_id: "prj_ok" }),
      del_svc: freshMeta({ provider: "supabase", resource_id: "ref_del" }),
      stale_svc: freshMeta({
        provider: "neon",
        resource_id: "proj_s",
        last_verified_at: daysAgo(14),
      }),
      deg_svc: freshMeta({ provider: "render", resource_id: "svc_d", region: "ohio" }),
    });
    const probes: LiveProbeMap = {
      vercel: ALIVE_PROBE,
      supabase: DELETED_PROBE,
      neon: ALIVE_PROBE,
      render: regionChangedProbe("frankfurt"),
    };
    const summary = await registry.reconcileAll({ liveProbes: probes });
    const kinds = Object.fromEntries(summary.results.map((r) => [r.service, r.drift.kind]));
    expect(kinds.ok_svc).toBe("ok");
    expect(kinds.del_svc).toBe("deleted");
    expect(kinds.stale_svc).toBe("stale");
    expect(kinds.deg_svc).toBe("degraded");
  });
});

// ---------------------------------------------------------------------------
// 10. Stale threshold edge cases
// ---------------------------------------------------------------------------

describe("Stale threshold edge cases", () => {
  test("exactly at threshold is still ok (boundary)", () => {
    // 500ms before threshold → should still be ok
    const thresholdMs = DEFAULT_STALE_THRESHOLD_MS;
    const registry = new ResourceLifecycle({
      svc: freshMeta({
        last_verified_at: new Date(Date.now() - thresholdMs + 500).toISOString(),
      }),
    });
    const drift = registry.computeDrift("svc", { staleThresholdMs: thresholdMs });
    expect(drift.kind).toBe("ok");
  });

  test("1ms past threshold is stale", () => {
    const thresholdMs = DEFAULT_STALE_THRESHOLD_MS;
    const registry = new ResourceLifecycle({
      svc: freshMeta({
        last_verified_at: new Date(Date.now() - thresholdMs - 1).toISOString(),
      }),
    });
    const drift = registry.computeDrift("svc", { staleThresholdMs: thresholdMs });
    expect(drift.kind).toBe("stale");
  });

  test("very old resource (epoch zero) is stale", () => {
    const registry = new ResourceLifecycle({
      svc: freshMeta({ last_verified_at: new Date(0).toISOString() }),
    });
    const drift = registry.computeDrift("svc");
    expect(drift.kind).toBe("stale");
  });
});

// ---------------------------------------------------------------------------
// 11. save() flushes to disk
// ---------------------------------------------------------------------------

describe("ResourceLifecycle — save()", () => {
  test("save() persists in-memory state to .stack.local.toml", async () => {
    const cwd = makeTmpDir();
    try {
      const registry = new ResourceLifecycle({}, cwd);
      registry.set("svc", freshMeta({ resource_id: "res_save_test" }));
      await registry.save();

      const reloaded = await ResourceLifecycle.load(cwd);
      expect(reloaded.get("svc")?.resource_id).toBe("res_save_test");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("save() after delete() removes the service from disk", async () => {
    const cwd = makeTmpDir();
    try {
      const registry = new ResourceLifecycle({ svc: freshMeta() }, cwd);
      await registry.save();

      registry.delete("svc");
      await registry.save();

      const reloaded = await ResourceLifecycle.load(cwd);
      expect(reloaded.get("svc")).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 12. ResourceLifecycle.load()
// ---------------------------------------------------------------------------

describe("ResourceLifecycle.load()", () => {
  test("loads an empty registry when file is absent", async () => {
    const cwd = makeTmpDir();
    try {
      const registry = await ResourceLifecycle.load(cwd);
      expect(registry.services()).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("loads a pre-existing lifecycle store from disk", async () => {
    const cwd = makeTmpDir();
    try {
      const meta = freshMeta({ resource_id: "res_load_test" });
      await writeLocalLifecycle({ svc: meta }, cwd);

      const registry = await ResourceLifecycle.load(cwd);
      expect(registry.get("svc")?.resource_id).toBe("res_load_test");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("load → mutate → save → reload round-trip", async () => {
    const cwd = makeTmpDir();
    try {
      await writeLocalLifecycle({ svc: freshMeta() }, cwd);

      const registry = await ResourceLifecycle.load(cwd);
      registry.set("svc2", freshMeta({ provider: "neon", resource_id: "proj_new" }));
      await registry.save();

      const reloaded = await ResourceLifecycle.load(cwd);
      expect(reloaded.services().sort()).toEqual(["svc", "svc2"]);
      expect(reloaded.get("svc2")?.provider).toBe("neon");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
