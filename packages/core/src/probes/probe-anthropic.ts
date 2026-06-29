/**
 * Anthropic token quota + daily spend probe.
 *
 * Calls GET /v1/models for liveness; inspects rate-limit headers for quota
 * utilization. Anthropic surfaces `anthropic-ratelimit-tokens-limit` and
 * `anthropic-ratelimit-tokens-remaining` on most endpoints.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "anthropic";

const probe: Probe = {
  provider: PROVIDER,
  label: "Anthropic token quota",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("ANTHROPIC_API_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "ANTHROPIC_API_KEY not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
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
          detail: `Anthropic /v1/models returned HTTP ${res.status}`,
        };
      }

      // Extract rate-limit headers (present on most Anthropic API responses).
      const limitTokens = res.headers.get("anthropic-ratelimit-tokens-limit");
      const remainingTokens = res.headers.get("anthropic-ratelimit-tokens-remaining");
      const limitRequests = res.headers.get("anthropic-ratelimit-requests-limit");
      const remainingRequests = res.headers.get("anthropic-ratelimit-requests-remaining");

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

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status: "ok",
        detail: "Anthropic API reachable",
      };
      if (rateLimitCeiling !== undefined) result.rateLimitCeiling = rateLimitCeiling;
      if (quotaUtilization !== undefined) result.quotaUtilization = quotaUtilization;

      if (quotaUtilization !== undefined && quotaUtilization >= 0.95) {
        result.status = "error";
        result.alertThreshold = "quotaUtilization >= 0.95";
      } else if (quotaUtilization !== undefined && quotaUtilization >= 0.8) {
        result.status = "warn";
        result.alertThreshold = "quotaUtilization >= 0.80";
      }

      return result;
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Anthropic probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
