/**
 * xAI (Grok) AI health-check probe.
 *
 * Calls GET /v1/models to validate the API key and surface rate-limit headers.
 * xAI uses an OpenAI-compatible API.
 *
 * Reference: https://docs.x.ai/api
 * Dashboard:  https://console.x.ai
 *
 * Credentials required: XAI_API_KEY
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "xai";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "xAI API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("XAI_API_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "XAI_API_KEY not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.x.ai/v1/models", {
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
          detail: `xAI /v1/models returned HTTP ${res.status} — check XAI_API_KEY`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "xAI API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `xAI /v1/models returned HTTP ${res.status}`,
        };
      }

      // Extract rate-limit headers (OpenAI-compatible style).
      const limitTokens = res.headers.get("x-ratelimit-limit-tokens");
      const remainingTokens = res.headers.get("x-ratelimit-remaining-tokens");
      const limitRequests = res.headers.get("x-ratelimit-limit-requests");
      const remainingRequests = res.headers.get("x-ratelimit-remaining-requests");

      let rateLimitCeiling: number | undefined;
      let quotaUtilization: number | undefined;

      if (limitTokens && remainingTokens) {
        const limit = parseInt(limitTokens, 10);
        const remaining = parseInt(remainingTokens, 10);
        if (!isNaN(limit) && !isNaN(remaining) && limit > 0) {
          rateLimitCeiling = limit;
          quotaUtilization = (limit - remaining) / limit;
        }
      } else if (limitRequests && remainingRequests) {
        const limit = parseInt(limitRequests, 10);
        const remaining = parseInt(remainingRequests, 10);
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
        detail: "xAI API reachable",
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
        detail: `xAI probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
