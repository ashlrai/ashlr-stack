/**
 * Linear issue sync quota probe.
 *
 * Calls the Linear GraphQL API to:
 *   - Check API rate limit headers on a lightweight introspection query
 *   - Surface the remaining request budget
 *
 * Linear's API returns `X-RateLimit-Remaining` and `X-RateLimit-Limit` headers
 * (1,500 requests / 60 seconds per API key on the free tier).
 *
 * Requires LINEAR_API_KEY.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "linear";

const probe: Probe = {
  provider: PROVIDER,
  label: "Linear issue sync quota",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("LINEAR_API_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "LINEAR_API_KEY not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ viewer { id name } }" }),
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Linear GraphQL returned HTTP ${res.status}`,
        };
      }

      // Surface rate-limit from response headers.
      const limitHeader = res.headers.get("X-RateLimit-Limit") ?? res.headers.get("x-ratelimit-limit");
      const remainingHeader = res.headers.get("X-RateLimit-Remaining") ?? res.headers.get("x-ratelimit-remaining");

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

      if (quotaUtilization !== undefined && quotaUtilization >= 0.95) {
        status = "error";
        alertThreshold = "quotaUtilization >= 0.95";
      } else if (quotaUtilization !== undefined && quotaUtilization >= 0.8) {
        status = "warn";
        alertThreshold = "quotaUtilization >= 0.80";
      }

      const data = (await res.json()) as { data?: { viewer?: { id: string; name: string } } };
      const viewer = data.data?.viewer;

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail: viewer
          ? `Linear API reachable (${viewer.name})`
          : "Linear API reachable",
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
        detail: `Linear probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
