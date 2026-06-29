/**
 * Plausible privacy-friendly analytics health-check probe.
 *
 * Calls GET /api/v1/sites to validate the API key and list configured sites.
 *
 * Reference: https://plausible.io/docs/stats-api
 * Dashboard:  https://plausible.io
 *
 * Credentials required: PLAUSIBLE_API_KEY
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "plausible";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Plausible API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const apiKey = await tryRevealSecret("PLAUSIBLE_API_KEY");
    if (!apiKey) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "PLAUSIBLE_API_KEY not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://plausible.io/api/v1/sites", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
          detail: `Plausible /api/v1/sites returned HTTP ${res.status} — check PLAUSIBLE_API_KEY`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Plausible API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Plausible /api/v1/sites returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as { sites?: unknown[] };
      const siteCount = body.sites?.length ?? 0;

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
        detail: `Plausible API reachable (${siteCount} site(s))`,
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
        detail: `Plausible probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
