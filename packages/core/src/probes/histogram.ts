/**
 * 7-day rolling histogram persistence for provider health probes.
 *
 * Stores samples in `.stack/telemetry/health-probes.json`, kept separate from
 * privacy-sensitive telemetry. Samples older than 7 days are pruned on every
 * write. Reads are tolerant of missing or corrupt files.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistogramSample, HistogramStore } from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// ---------------------------------------------------------------------------
// Path resolution (overridable for tests)
// ---------------------------------------------------------------------------

let _storeDirOverride: string | undefined;

/**
 * Override the directory that contains `health-probes.json`.
 * FOR TESTS ONLY. Pass `undefined` to restore the default (cwd-relative).
 */
export function __setHistogramDirForTesting(dir: string | undefined): void {
  _storeDirOverride = dir;
}

function storeDir(cwd: string): string {
  return _storeDirOverride ?? join(cwd, ".stack", "telemetry");
}

function storePath(cwd: string): string {
  return join(storeDir(cwd), "health-probes.json");
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

export async function readHistogram(cwd: string): Promise<HistogramStore> {
  const path = storePath(cwd);
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as HistogramStore;
  } catch {
    return {};
  }
}

export async function writeHistogram(cwd: string, store: HistogramStore): Promise<void> {
  const dir = storeDir(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(storePath(cwd), `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a new sample for `provider`, prune samples older than 7 days, and
 * persist. Returns the updated store.
 */
export async function appendSample(
  cwd: string,
  provider: string,
  sample: HistogramSample,
): Promise<HistogramStore> {
  const store = await readHistogram(cwd);
  const now = Date.now();
  const existing = (store[provider] ?? []).filter((s) => now - s.ts < RETENTION_MS);
  store[provider] = [...existing, sample];
  await writeHistogram(cwd, store);
  return store;
}

// ---------------------------------------------------------------------------
// Percentile computation
// ---------------------------------------------------------------------------

/**
 * Compute a percentile (0–100) over latencyMs values for a provider.
 * Returns `undefined` if there are no samples.
 */
export function latencyPercentile(
  store: HistogramStore,
  provider: string,
  pct: number,
): number | undefined {
  const samples = store[provider];
  if (!samples || samples.length === 0) return undefined;
  const sorted = [...samples].map((s) => s.latencyMs).sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute p50 and p95 latency for a provider from the stored histogram.
 */
export function computePercentiles(
  store: HistogramStore,
  provider: string,
): { p50Ms: number | undefined; p95Ms: number | undefined } {
  return {
    p50Ms: latencyPercentile(store, provider, 50),
    p95Ms: latencyPercentile(store, provider, 95),
  };
}
