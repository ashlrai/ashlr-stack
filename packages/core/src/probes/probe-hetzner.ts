/**
 * Hetzner Cloud health-check probe.
 *
 * Calls GET /v1/servers?page=1&per_page=1 to validate the API token and
 * surface rate-limit headers.
 *
 * Reference: https://docs.hetzner.cloud/
 * Dashboard:  https://console.hetzner.cloud
 *
 * Credentials required: HETZNER_API_TOKEN
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "hetzner";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Hetzner Cloud API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("HETZNER_API_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "HETZNER_API_TOKEN not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.hetzner.cloud/v1/servers?page=1&per_page=1", {
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
          detail: `Hetzner /v1/servers returned HTTP ${res.status} — check HETZNER_API_TOKEN`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Hetzner API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Hetzner /v1/servers returned HTTP ${res.status}`,
        };
      }

      // Hetzner uses X-RateLimit-Limit and X-RateLimit-Remaining headers.
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
        detail: "Hetzner API token valid",
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
        detail: `Hetzner probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
