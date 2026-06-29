/**
 * Datadog metrics/traces/logs health-check probe.
 *
 * Calls GET /api/v1/validate to validate the API key, then surfaces
 * rate-limit headers.
 *
 * Reference: https://docs.datadoghq.com/api/latest/
 * Dashboard:  https://app.datadoghq.com
 *
 * Credentials required: DD_API_KEY, DD_APP_KEY
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "datadog";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Datadog API key validation",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const apiKey = await tryRevealSecret("DD_API_KEY");
    if (!apiKey) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "DD_API_KEY not in vault — probe skipped",
      };
    }

    const appKey = await tryRevealSecret("DD_APP_KEY");

    const headers: HeadersInit = {
      "DD-API-KEY": apiKey,
      "Content-Type": "application/json",
    };
    if (appKey) {
      (headers as Record<string, string>)["DD-APPLICATION-KEY"] = appKey;
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.datadoghq.com/api/v1/validate", {
        headers,
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (res.status === 401 || res.status === 403) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Datadog /api/v1/validate returned HTTP ${res.status} — check DD_API_KEY`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Datadog API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Datadog /api/v1/validate returned HTTP ${res.status}`,
        };
      }

      // Rate-limit headers: X-RateLimit-Limit / X-RateLimit-Remaining
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

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail: "Datadog API key valid",
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
        detail: `Datadog probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
