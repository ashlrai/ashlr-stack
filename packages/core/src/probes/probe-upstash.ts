/**
 * Upstash serverless Redis + Kafka health-check probe.
 *
 * Calls GET /v2/redis/databases to validate the management token and surface
 * database quota information.
 *
 * Reference: https://upstash.com/docs/devops/developer-api
 * Dashboard:  https://console.upstash.com
 *
 * Credentials required: UPSTASH_MANAGEMENT_TOKEN
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "upstash";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Upstash management API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("UPSTASH_MANAGEMENT_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "UPSTASH_MANAGEMENT_TOKEN not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.upstash.com/v2/redis/databases", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (res.status === 401 || res.status === 403) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Upstash /v2/redis/databases returned HTTP ${res.status} — check UPSTASH_MANAGEMENT_TOKEN`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Upstash API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Upstash /v2/redis/databases returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as Array<{
        database_name?: string;
        max_daily_requests?: number;
        used_daily_requests?: number;
      }>;
      const dbCount = Array.isArray(body) ? body.length : 0;

      // Calculate quota utilization across all databases (take max utilization).
      let maxUtilization = 0;
      if (Array.isArray(body)) {
        for (const db of body) {
          if (db.max_daily_requests && db.used_daily_requests !== undefined) {
            const util = db.max_daily_requests > 0
              ? db.used_daily_requests / db.max_daily_requests
              : 0;
            if (util > maxUtilization) maxUtilization = util;
          }
        }
      }

      const limitStr = res.headers.get("x-ratelimit-limit");
      const remainingStr = res.headers.get("x-ratelimit-remaining");

      let rateLimitCeiling: number | undefined;
      let quotaUtilization: number | undefined;

      if (limitStr && remainingStr) {
        const limit = parseInt(limitStr, 10);
        const remaining = parseInt(remainingStr, 10);
        if (!isNaN(limit) && !isNaN(remaining) && limit > 0) {
          rateLimitCeiling = limit;
          quotaUtilization = (limit - remaining) / limit;
        }
      }

      // Use database-level utilization if higher than header-based.
      if (maxUtilization > 0 && (quotaUtilization === undefined || maxUtilization > quotaUtilization)) {
        quotaUtilization = maxUtilization;
      }

      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;

      if (quotaUtilization !== undefined && quotaUtilization >= ERROR_THRESHOLD) {
        status = "error";
        alertThreshold = `quotaUtilization >= ${ERROR_THRESHOLD}`;
      } else if (quotaUtilization !== undefined && quotaUtilization >= WARN_THRESHOLD) {
        status = "warn";
        alertThreshold = `quotaUtilization >= ${WARN_THRESHOLD}`;
      }

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail: `Upstash API reachable (${dbCount} Redis database(s))`,
      };
      if (rateLimitCeiling !== undefined) result.rateLimitCeiling = rateLimitCeiling;
      if (quotaUtilization !== undefined) result.quotaUtilization = quotaUtilization;
      if (alertThreshold !== undefined) result.alertThreshold = alertThreshold;

      return result;
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Upstash probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
