/**
 * Turso edge SQLite health-check probe.
 *
 * Calls GET /v1/organizations to validate the platform token and surface
 * database quota information.
 *
 * Reference: https://docs.turso.tech
 * Dashboard:  https://app.turso.tech
 *
 * Credentials required: TURSO_PLATFORM_TOKEN
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "turso";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Turso platform API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("TURSO_PLATFORM_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "TURSO_PLATFORM_TOKEN not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.turso.tech/v1/organizations", {
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
          detail: `Turso /v1/organizations returned HTTP ${res.status} — check TURSO_PLATFORM_TOKEN`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Turso API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Turso /v1/organizations returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as Array<{ name?: string; slug?: string }>;
      const orgCount = Array.isArray(body) ? body.length : 0;
      const orgName = Array.isArray(body) ? (body[0]?.name ?? body[0]?.slug) : undefined;

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

      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;

      if (quotaUtilization !== undefined && quotaUtilization >= ERROR_THRESHOLD) {
        status = "error";
        alertThreshold = `quotaUtilization >= ${ERROR_THRESHOLD}`;
      } else if (quotaUtilization !== undefined && quotaUtilization >= WARN_THRESHOLD) {
        status = "warn";
        alertThreshold = `quotaUtilization >= ${WARN_THRESHOLD}`;
      }

      const detail = orgName
        ? `Turso API reachable (org: ${orgName})`
        : `Turso API reachable (${orgCount} org(s))`;

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail,
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
        detail: `Turso probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
