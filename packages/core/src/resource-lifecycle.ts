/**
 * Resource Lifecycle Registry
 *
 * Tracks provider-side resource metadata (creation timestamps, last-verified
 * state, region/tier info) and implements drift detection via the probe system.
 *
 * Persisted to `.stack.local.toml` under the `[lifecycle]` table (per-service
 * sub-keys).  The registry is read-only at construction time; callers call
 * `save()` to flush changes back through `writeLocalLifecycle`.
 *
 * Drift detection:
 *   - "deleted"   — resource_id no longer exists on the provider side
 *   - "degraded"  — region or tier changed (downgrade / migration)
 *   - "stale"     — last-verified timestamp older than `staleThresholdMs`
 *   - "ok"        — resource verified live, all fields match
 *   - "unknown"   — not enough info to determine (no probe, no resource_id)
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { LOCAL_FILENAME } from "./config.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Drift kind surfaced by reconcile / doctor --drift. */
export type DriftKind = "ok" | "deleted" | "degraded" | "stale" | "unknown";

/** Stored metadata per resource in .stack.local.toml [lifecycle.<service>]. */
export interface ResourceLifecycleMeta {
  /** Provider-side resource ID (project_ref, app name, etc.). */
  resource_id: string;
  /** Provider name (e.g. "supabase", "vercel"). */
  provider: string;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 — last time we successfully verified this resource is alive. */
  last_verified_at: string;
  /** Last known region reported by the provider (may be undefined). */
  region?: string;
  /** Last known tier / plan reported by the provider (may be undefined). */
  tier?: string;
  /** Arbitrary provider-specific fields. */
  meta?: Record<string, unknown>;
}

/** The diff between local record and live provider state. */
export interface ResourceDrift {
  service: string;
  kind: DriftKind;
  /** Human-readable explanation. */
  detail: string;
  /** Snapshot of what we have locally. */
  local: ResourceLifecycleMeta;
  /** What the live API returned (partial — only checked fields). */
  live?: Partial<ResourceLifecycleMeta>;
}

/** Result of a single reconcile attempt. */
export interface ReconcileResult {
  service: string;
  /** Whether the record was mutated (region/tier corrected, timestamp bumped). */
  patched: boolean;
  drift: ResourceDrift;
  /** Any error thrown during the live probe. */
  error?: string;
}

/** Summary returned by `reconcileAll`. */
export interface ReconcileSummary {
  reconciledAt: string;
  total: number;
  ok: number;
  patched: number;
  failed: number;
  results: ReconcileResult[];
}

// ---------------------------------------------------------------------------
// Options passed to live-validation probes
// ---------------------------------------------------------------------------

/**
 * A simple async function that checks whether a resource is still alive.
 * Providers that cannot be probed return `{ alive: true }` (best-effort).
 *
 * @param resourceId  Provider-side resource ID.
 * @param meta        Full lifecycle record for the resource.
 * @returns           Live state partial.  `alive: false` ⇒ deleted.
 */
export type LiveProbe = (
  resourceId: string,
  meta: ResourceLifecycleMeta,
) => Promise<{
  alive: boolean;
  region?: string;
  tier?: string;
  extra?: Record<string, unknown>;
}>;

/** Per-provider map of live-probe functions. */
export type LiveProbeMap = Record<string, LiveProbe>;

// ---------------------------------------------------------------------------
// Default stale threshold (7 days)
// ---------------------------------------------------------------------------

export const DEFAULT_STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Persistence helpers (read/write only the [lifecycle] section)
// ---------------------------------------------------------------------------

export type LifecycleStore = Record<string, ResourceLifecycleMeta>;

/**
 * Read the lifecycle section from `.stack.local.toml`.
 * Returns an empty object if the file does not exist or has no `[lifecycle]`.
 */
export async function readLocalLifecycle(cwd: string = process.cwd()): Promise<LifecycleStore> {
  const localPath = resolve(join(cwd, LOCAL_FILENAME));
  if (!existsSync(localPath)) return {};

  const raw = parseToml(await readFile(localPath, "utf-8")) as Record<string, unknown>;
  const section = raw.lifecycle as Record<string, unknown> | undefined;
  if (!section) return {};

  const store: LifecycleStore = {};
  for (const [key, value] of Object.entries(section)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      store[key] = value as ResourceLifecycleMeta;
    }
  }
  return store;
}

/**
 * Merge the lifecycle section into `.stack.local.toml`, preserving all other
 * top-level keys.
 */
export async function writeLocalLifecycle(
  store: LifecycleStore,
  cwd: string = process.cwd(),
): Promise<void> {
  const localPath = resolve(join(cwd, LOCAL_FILENAME));

  let existing: Record<string, unknown> = {};
  if (existsSync(localPath)) {
    existing = parseToml(await readFile(localPath, "utf-8")) as Record<string, unknown>;
  }

  existing.lifecycle = store as unknown as Record<string, unknown>;

  const header = "# Ashlr Stack — local instance data. Auto-generated; do not commit.\n";
  await writeFile(localPath, header + stringifyToml(existing), "utf-8");
}

// ---------------------------------------------------------------------------
// ResourceLifecycle registry
// ---------------------------------------------------------------------------

export class ResourceLifecycle {
  private store: LifecycleStore;
  private readonly cwd: string;

  constructor(store: LifecycleStore, cwd: string = process.cwd()) {
    this.store = { ...store };
    this.cwd = cwd;
  }

  // ---- CRUD -----------------------------------------------------------------

  /** Return the metadata for a service, or undefined if not tracked. */
  get(service: string): ResourceLifecycleMeta | undefined {
    return this.store[service];
  }

  /** Upsert a lifecycle record. Does not flush to disk. Call `save()` after. */
  set(service: string, meta: ResourceLifecycleMeta): void {
    this.store[service] = { ...meta };
  }

  /** Remove a lifecycle record (e.g. after `stack remove`). */
  delete(service: string): void {
    delete this.store[service];
  }

  /** All tracked service names. */
  services(): string[] {
    return Object.keys(this.store);
  }

  /** Flush in-memory state to `.stack.local.toml`. */
  async save(): Promise<void> {
    await writeLocalLifecycle(this.store, this.cwd);
  }

  // ---- Drift detection (pure — no I/O) -------------------------------------

  /**
   * Compute drift for a single service against an optional live snapshot.
   * Does NOT call the network — callers provide the `live` snapshot.
   */
  computeDrift(
    service: string,
    opts: {
      live?: Partial<ResourceLifecycleMeta> & { alive?: boolean };
      staleThresholdMs?: number;
    } = {},
  ): ResourceDrift {
    const local = this.store[service];
    if (!local) {
      return {
        service,
        kind: "unknown",
        detail: `No lifecycle record for service "${service}"`,
        local: {
          resource_id: "",
          provider: "",
          created_at: new Date(0).toISOString(),
          last_verified_at: new Date(0).toISOString(),
        },
      };
    }

    const { live, staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS } = opts;

    // 1. Deleted?
    if (live && live.alive === false) {
      return {
        service,
        kind: "deleted",
        detail: `Resource "${local.resource_id}" (${local.provider}) no longer exists on the provider.`,
        local,
        live,
      };
    }

    // 2. Region / tier downgrade?
    if (live) {
      const regionChanged =
        live.region !== undefined && local.region !== undefined && live.region !== local.region;
      const tierChanged =
        live.tier !== undefined && local.tier !== undefined && live.tier !== local.tier;

      if (regionChanged || tierChanged) {
        const changes: string[] = [];
        if (regionChanged) changes.push(`region: ${local.region} → ${live.region}`);
        if (tierChanged) changes.push(`tier: ${local.tier} → ${live.tier}`);
        return {
          service,
          kind: "degraded",
          detail: `Resource "${local.resource_id}" drifted: ${changes.join(", ")}`,
          local,
          live,
        };
      }
    }

    // 3. Stale (last_verified_at too old)?
    const lastVerified = new Date(local.last_verified_at).getTime();
    const age = Date.now() - lastVerified;
    if (age > staleThresholdMs) {
      return {
        service,
        kind: "stale",
        detail: `Resource "${local.resource_id}" has not been verified in ${Math.floor(age / 86_400_000)} day(s).`,
        local,
        live,
      };
    }

    return {
      service,
      kind: "ok",
      detail: `Resource "${local.resource_id}" is live and up to date.`,
      local,
      live,
    };
  }

  // ---- Reconcile -----------------------------------------------------------

  /**
   * Re-validate a single service against live API state.
   *
   * - Calls the `liveProbe` for the service's provider (if registered).
   * - Detects deleted / degraded / stale resources.
   * - When `apply: true`, auto-patches region/tier drift and bumps
   *   `last_verified_at`; does NOT recreate deleted resources.
   */
  async reconcileOne(
    service: string,
    opts: {
      liveProbes?: LiveProbeMap;
      apply?: boolean;
      staleThresholdMs?: number;
    } = {},
  ): Promise<ReconcileResult> {
    const { liveProbes = {}, apply = false, staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS } = opts;
    const local = this.store[service];

    if (!local) {
      const drift = this.computeDrift(service, { staleThresholdMs });
      return { service, patched: false, drift };
    }

    const probe = liveProbes[local.provider];
    let liveSnapshot: (Partial<ResourceLifecycleMeta> & { alive?: boolean }) | undefined;
    let probeError: string | undefined;

    if (probe) {
      try {
        const result = await probe(local.resource_id, local);
        liveSnapshot = {
          alive: result.alive,
          region: result.region,
          tier: result.tier,
          ...(result.extra ?? {}),
        };
      } catch (err) {
        probeError = (err as Error).message;
        // Treat probe errors as "unknown" rather than "deleted"
        liveSnapshot = { alive: true };
      }
    }

    const drift = this.computeDrift(service, { live: liveSnapshot, staleThresholdMs });

    let patched = false;
    if (apply && drift.kind !== "unknown" && drift.kind !== "deleted") {
      const updated = { ...local };

      // Patch region/tier drift
      if (liveSnapshot?.region && liveSnapshot.region !== local.region) {
        updated.region = liveSnapshot.region;
        patched = true;
      }
      if (liveSnapshot?.tier && liveSnapshot.tier !== local.tier) {
        updated.tier = liveSnapshot.tier;
        patched = true;
      }

      // Always bump last_verified_at on a successful probe
      if (probe && !probeError && liveSnapshot?.alive !== false) {
        updated.last_verified_at = new Date().toISOString();
        patched = true;
      }

      if (patched) {
        this.store[service] = updated;
      }
    }

    return { service, patched, drift, ...(probeError ? { error: probeError } : {}) };
  }

  /**
   * Reconcile all tracked services concurrently.
   * Returns a summary of all drift results and optional patches.
   */
  async reconcileAll(
    opts: {
      liveProbes?: LiveProbeMap;
      apply?: boolean;
      staleThresholdMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<ReconcileSummary> {
    const services = this.services();
    const results = await Promise.all(
      services.map((s) => this.reconcileOne(s, opts)),
    );

    if (opts.apply) {
      await this.save();
    }

    const ok = results.filter((r) => r.drift.kind === "ok").length;
    const patched = results.filter((r) => r.patched).length;
    const failed = results.filter((r) => r.error !== undefined).length;

    return {
      reconciledAt: new Date().toISOString(),
      total: results.length,
      ok,
      patched,
      failed,
      results,
    };
  }

  // ---- Factory --------------------------------------------------------------

  /** Load a registry from `.stack.local.toml` for the given directory. */
  static async load(cwd: string = process.cwd()): Promise<ResourceLifecycle> {
    const store = await readLocalLifecycle(cwd);
    return new ResourceLifecycle(store, cwd);
  }

  /**
   * Seed a lifecycle record from an existing `ServiceEntry` (called at
   * provision time).  Region and tier are optional.
   */
  static seedFromService(
    service: string,
    opts: {
      resource_id: string;
      provider: string;
      region?: string;
      tier?: string;
      meta?: Record<string, unknown>;
      created_at?: string;
    },
  ): ResourceLifecycleMeta {
    const now = new Date().toISOString();
    return {
      resource_id: opts.resource_id,
      provider: opts.provider,
      created_at: opts.created_at ?? now,
      last_verified_at: now,
      ...(opts.region ? { region: opts.region } : {}),
      ...(opts.tier ? { tier: opts.tier } : {}),
      ...(opts.meta ? { meta: opts.meta } : {}),
    };
  }
}
