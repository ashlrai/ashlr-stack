/**
 * OpenAI token quota + daily spend probe.
 *
 * Calls:
 *   GET /v1/models          — liveness + latency
 *   GET /dashboard/billing/usage  — estimated daily burn (USD)
 *
 * The billing endpoint requires an API key with org-level access; if it 401s
 * we degrade gracefully and return status "ok" without spend info.
 *
 * Rate-limit headers from the /v1/models response surface the ceiling.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "openai";

const probe: Probe = {
  provider: PROVIDER,
  label: "OpenAI token quota + daily spend",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("OPENAI_API_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "OPENAI_API_KEY not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
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
          detail: `OpenAI /v1/models returned HTTP ${res.status}`,
        };
      }

      // Surface rate-limit ceiling from response headers.
      const limitRequests = res.headers.get("x-ratelimit-limit-requests");
      const limitTokens = res.headers.get("x-ratelimit-limit-tokens");
      const remainingRequests = res.headers.get("x-ratelimit-remaining-requests");
      const remainingTokens = res.headers.get("x-ratelimit-remaining-tokens");

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

      // Attempt billing usage call — degrade gracefully if forbidden.
      let estimatedDailyBurnUSD: number | undefined;
      try {
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10);
        const billingRes = await fetch(
          `https://api.openai.com/dashboard/billing/usage?start_date=${dateStr}&end_date=${dateStr}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctx.signal,
          },
        );
        if (billingRes.ok) {
          const billing = (await billingRes.json()) as { total_usage?: number };
          // total_usage is in cents
          if (typeof billing.total_usage === "number") {
            estimatedDailyBurnUSD = billing.total_usage / 100;
          }
        }
      } catch {
        // Billing endpoint failure is non-fatal.
      }

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status: "ok",
        detail: "OpenAI API reachable",
      };
      if (rateLimitCeiling !== undefined) result.rateLimitCeiling = rateLimitCeiling;
      if (quotaUtilization !== undefined) result.quotaUtilization = quotaUtilization;
      if (estimatedDailyBurnUSD !== undefined) result.estimatedDailyBurnUSD = estimatedDailyBurnUSD;

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
        detail: `OpenAI probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
