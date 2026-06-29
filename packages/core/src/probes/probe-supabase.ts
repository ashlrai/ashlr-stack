/**
 * Supabase compute + db rows probe.
 *
 * Calls the Supabase Management API to inspect the project's database usage:
 *   GET /v1/projects/{ref}/usage  → db_size_bytes, rows estimate
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN and
 * SUPABASE_PROJECT_REF (or falls back to SUPABASE_URL to extract the ref).
 *
 * Warns when estimated row utilization exceeds free-tier thresholds.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "supabase";

/** Free-tier Supabase allows ~500 MB database size before compute billing kicks in. */
const DB_SIZE_WARN_BYTES = 450 * 1024 * 1024; // 450 MB
const DB_SIZE_ERROR_BYTES = 490 * 1024 * 1024; // 490 MB

function extractRefFromUrl(url: string): string | undefined {
  // e.g. https://abcdefghijklmnop.supabase.co  →  abcdefghijklmnop
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  return m?.[1];
}

const probe: Probe = {
  provider: PROVIDER,
  label: "Supabase db size + compute",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token =
      (await tryRevealSecret("SUPABASE_ACCESS_TOKEN")) ??
      (await tryRevealSecret("SUPABASE_SERVICE_ROLE_KEY"));

    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "SUPABASE_ACCESS_TOKEN / SUPABASE_SERVICE_ROLE_KEY not in vault — probe skipped",
      };
    }

    // Resolve project ref.
    let projectRef = await tryRevealSecret("SUPABASE_PROJECT_REF");
    if (!projectRef) {
      const url = await tryRevealSecret("SUPABASE_URL");
      if (url) projectRef = extractRefFromUrl(url);
    }

    if (!projectRef) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail:
          "Cannot resolve Supabase project ref — set SUPABASE_PROJECT_REF or SUPABASE_URL",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/usage`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Supabase usage API returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as {
        usages?: Array<{ metric: string; usage: number; limit: number; available: number }>;
      };

      // Find db_size metric if available.
      const dbMetric = body.usages?.find((u) => u.metric === "db_size");
      const dbBytes = dbMetric?.usage ?? 0;
      const dbLimit = dbMetric?.limit ?? 0;

      let quotaUtilization: number | undefined;
      if (dbLimit > 0) {
        quotaUtilization = dbBytes / dbLimit;
      }

      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;

      if (dbBytes >= DB_SIZE_ERROR_BYTES) {
        status = "error";
        alertThreshold = `db_size >= ${DB_SIZE_ERROR_BYTES} bytes`;
      } else if (dbBytes >= DB_SIZE_WARN_BYTES) {
        status = "warn";
        alertThreshold = `db_size >= ${DB_SIZE_WARN_BYTES} bytes`;
      }

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail: dbBytes > 0 ? `db size: ${(dbBytes / 1024 / 1024).toFixed(1)} MB` : "Supabase usage API reachable",
      };
      if (quotaUtilization !== undefined) result.quotaUtilization = quotaUtilization;
      if (alertThreshold) result.alertThreshold = alertThreshold;

      return result;
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Supabase probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
