/**
 * DigitalOcean Droplets/Kubernetes health-check probe.
 *
 * Calls GET /v2/account to validate the personal access token and surface
 * rate-limit headers.
 *
 * Reference: https://docs.digitalocean.com/reference/api/api-reference/
 * Dashboard:  https://cloud.digitalocean.com
 *
 * Credentials required: DIGITALOCEAN_TOKEN
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "digitalocean";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "DigitalOcean account health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("DIGITALOCEAN_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "DIGITALOCEAN_TOKEN not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.digitalocean.com/v2/account", {
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
          detail: `DigitalOcean /v2/account returned HTTP ${res.status} — check DIGITALOCEAN_TOKEN`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "DigitalOcean API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `DigitalOcean /v2/account returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as {
        account?: { droplet_limit?: number; floating_ip_limit?: number; email?: string };
      };

      // DigitalOcean returns RateLimit-Limit and RateLimit-Remaining headers.
      const limitStr = res.headers.get("ratelimit-limit");
      const remainingStr = res.headers.get("ratelimit-remaining");

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

      const dropletLimit = body.account?.droplet_limit;
      const detail = dropletLimit !== undefined
        ? `DigitalOcean account reachable (droplet limit: ${dropletLimit})`
        : "DigitalOcean account reachable";

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
        detail: `DigitalOcean probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
