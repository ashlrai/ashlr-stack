/**
 * Convex health-check probe.
 *
 * Convex uses a deploy key for CI/CD. We validate the key by attempting
 * to list available deployments via the Convex admin API.
 *
 * Reference: https://docs.convex.dev
 * Dashboard:  https://dashboard.convex.dev
 *
 * Credentials required: CONVEX_DEPLOY_KEY
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "convex";

const probe: Probe = {
  provider: PROVIDER,
  label: "Convex deploy key health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("CONVEX_DEPLOY_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "CONVEX_DEPLOY_KEY not in vault — probe skipped",
      };
    }

    // Extract deployment URL from the deploy key (format: prod:https://...|key)
    // or fall back to the Convex dashboard API.
    let deploymentUrl: string | undefined;
    const urlMatch = token.match(/https?:\/\/[^|]+/);
    if (urlMatch) {
      deploymentUrl = urlMatch[0];
    }

    const start = Date.now();
    try {
      // Use the Convex admin API to validate the key.
      const baseUrl = deploymentUrl ?? "https://dashboard.convex.dev";
      const res = await fetch(`${baseUrl}/api/deploy2/deployment_status`, {
        method: "GET",
        headers: {
          Authorization: `Convex ${token}`,
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
          detail: `Convex deploy key returned HTTP ${res.status} — check CONVEX_DEPLOY_KEY`,
        };
      }

      // Convex returns 404 if the endpoint doesn't exist but auth is valid,
      // or 200/other on success. Treat auth errors (401/403) as errors, rest as ok.
      const rateLimitStr = res.headers.get("x-ratelimit-remaining");
      const rateLimitLimitStr = res.headers.get("x-ratelimit-limit");

      let rateLimitCeiling: number | undefined;
      let quotaUtilization: number | undefined;

      if (rateLimitLimitStr && rateLimitStr) {
        const limit = parseInt(rateLimitLimitStr, 10);
        const remaining = parseInt(rateLimitStr, 10);
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
        detail: "Convex deploy key is valid",
      };
      if (rateLimitCeiling !== undefined) result.rateLimitCeiling = rateLimitCeiling;
      if (quotaUtilization !== undefined) result.quotaUtilization = quotaUtilization;

      return result;
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Convex probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
