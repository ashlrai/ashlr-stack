/**
 * Sentry error + performance tracking health-check probe.
 *
 * Calls GET /api/0/projects/ to validate the auth token and surface
 * rate-limit headers.
 *
 * Reference: https://docs.sentry.io/api/
 * Dashboard:  https://sentry.io
 *
 * Credentials required: SENTRY_AUTH_TOKEN
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "sentry";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Sentry API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("SENTRY_AUTH_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "SENTRY_AUTH_TOKEN not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://sentry.io/api/0/projects/?per_page=1", {
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
          detail: `Sentry /api/0/projects/ returned HTTP ${res.status} — check SENTRY_AUTH_TOKEN`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Sentry API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Sentry /api/0/projects/ returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as unknown[];
      const projectCount = Array.isArray(body) ? body.length : 0;

      // Sentry rate-limit headers: X-Sentry-Rate-Limit-Limit / X-Sentry-Rate-Limit-Remaining
      // or standard X-RateLimit-* headers.
      const limitStr =
        res.headers.get("x-sentry-rate-limit-limit") ?? res.headers.get("x-ratelimit-limit");
      const remainingStr =
        res.headers.get("x-sentry-rate-limit-remaining") ?? res.headers.get("x-ratelimit-remaining");

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
        detail: `Sentry API reachable (${projectCount} project(s) visible)`,
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
        detail: `Sentry probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
