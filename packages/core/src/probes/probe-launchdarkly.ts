/**
 * LaunchDarkly feature flags + experimentation health-check probe.
 *
 * Calls GET /api/v2/caller-identity to validate the API token and surface
 * rate-limit headers.
 *
 * Reference: https://apidocs.launchdarkly.com/
 * Dashboard:  https://app.launchdarkly.com
 *
 * Credentials required: LAUNCHDARKLY_API_TOKEN
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "launchdarkly";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "LaunchDarkly API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("LAUNCHDARKLY_API_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "LAUNCHDARKLY_API_TOKEN not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://app.launchdarkly.com/api/v2/caller-identity", {
        headers: {
          Authorization: token,
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
          detail: `LaunchDarkly /api/v2/caller-identity returned HTTP ${res.status} — check LAUNCHDARKLY_API_TOKEN`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "LaunchDarkly API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `LaunchDarkly /api/v2/caller-identity returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as { accountId?: string; tokenName?: string };

      // LaunchDarkly rate-limit headers: X-RateLimit-Global-Reset, X-RateLimit-Route-Remaining, etc.
      const limitStr = res.headers.get("x-ratelimit-route-limit") ?? res.headers.get("x-ratelimit-limit");
      const remainingStr = res.headers.get("x-ratelimit-route-remaining") ?? res.headers.get("x-ratelimit-remaining");

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

      const detail = body.tokenName
        ? `LaunchDarkly API token "${body.tokenName}" valid`
        : "LaunchDarkly API token valid";

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
        detail: `LaunchDarkly probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
