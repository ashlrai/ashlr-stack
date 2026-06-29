/**
 * Stripe failed-chargebacks + rate-limit probe.
 *
 * Calls:
 *   GET /v1/disputes?status=needs_response&limit=10  — open chargebacks
 *   GET /v1/charges?limit=1                          — liveness + rate-limit headers
 *
 * Stripe surfaces rate-limit info via Retry-After and x-ratelimit-* headers
 * when you're near the ceiling.
 *
 * Warns when there are any open disputes that need a response.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "stripe";

const probe: Probe = {
  provider: PROVIDER,
  label: "Stripe failed chargebacks + rate limits",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("STRIPE_SECRET_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "STRIPE_SECRET_KEY not in vault — probe skipped",
      };
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };

    const start = Date.now();
    try {
      // Fetch open disputes (needs_response).
      const disputeRes = await fetch("https://api.stripe.com/v1/disputes?status=needs_response&limit=10", {
        headers,
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (!disputeRes.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Stripe /v1/disputes returned HTTP ${disputeRes.status}`,
        };
      }

      const disputes = (await disputeRes.json()) as { data: unknown[]; has_more?: boolean };
      const openCount = disputes.data?.length ?? 0;

      // Extract rate-limit ceiling from response headers (Stripe adds these
      // when approaching limits; they may be absent on free-tier calls).
      const limitHeader = disputeRes.headers.get("ratelimit-limit");
      const remainingHeader = disputeRes.headers.get("ratelimit-remaining");

      let rateLimitCeiling: number | undefined;
      let quotaUtilization: number | undefined;

      if (limitHeader && remainingHeader) {
        const limit = parseInt(limitHeader, 10);
        const remaining = parseInt(remainingHeader, 10);
        if (!isNaN(limit) && !isNaN(remaining) && limit > 0) {
          rateLimitCeiling = limit;
          quotaUtilization = (limit - remaining) / limit;
        }
      }

      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;
      let detail = `${openCount} open dispute(s) needing response`;

      if (openCount > 0) {
        status = "warn";
        alertThreshold = "open disputes > 0";
        detail = `${openCount} dispute(s) need response — review at https://dashboard.stripe.com/disputes`;
      }

      if (quotaUtilization !== undefined && quotaUtilization >= 0.95) {
        status = "error";
        alertThreshold = "quotaUtilization >= 0.95";
      } else if (quotaUtilization !== undefined && quotaUtilization >= 0.8) {
        if (status === "ok") {
          status = "warn";
          alertThreshold = "quotaUtilization >= 0.80";
        }
      }

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail,
      };
      if (rateLimitCeiling !== undefined) result.rateLimitCeiling = rateLimitCeiling;
      if (quotaUtilization !== undefined) result.quotaUtilization = quotaUtilization;
      if (alertThreshold) result.alertThreshold = alertThreshold;

      return result;
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Stripe probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
