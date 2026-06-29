/**
 * Clerk MAU utilization probe.
 *
 * Calls GET /v1/instance to get the instance details and then
 * GET /v1/users/count to estimate MAU.
 *
 * Free tier: 10,000 MAU. Warns at >= 80%, errors at >= 95%.
 *
 * Requires CLERK_SECRET_KEY.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "clerk";
const FREE_TIER_MAU = 10_000;

const probe: Probe = {
  provider: PROVIDER,
  label: "Clerk MAU utilization",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("CLERK_SECRET_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "CLERK_SECRET_KEY not in vault — probe skipped",
      };
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();
    try {
      // Get total user count as a proxy for MAU.
      const countRes = await fetch("https://api.clerk.com/v1/users/count", {
        headers,
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (!countRes.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Clerk /v1/users/count returned HTTP ${countRes.status}`,
        };
      }

      const data = (await countRes.json()) as { object?: string; total_count?: number };
      const totalUsers = data.total_count ?? 0;

      // Attempt to get plan-level MAU limit from the instance.
      let mauLimit = FREE_TIER_MAU;
      try {
        const instanceRes = await fetch("https://api.clerk.com/v1/instance", {
          headers,
          signal: ctx.signal,
        });
        if (instanceRes.ok) {
          const instance = (await instanceRes.json()) as {
            organization_settings?: { max_allowed_memberships?: number };
          };
          // max_allowed_memberships is the closest proxy in v1; it's not MAU
          // but gives an org limit hint. Fall back to free tier if not present.
          const maxMemberships = instance.organization_settings?.max_allowed_memberships;
          if (maxMemberships && maxMemberships > 0) mauLimit = maxMemberships;
        }
      } catch {
        // Instance call failure is non-fatal; use free-tier default.
      }

      const quotaUtilization = mauLimit > 0 ? totalUsers / mauLimit : 0;

      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;

      if (quotaUtilization >= 0.95) {
        status = "error";
        alertThreshold = "quotaUtilization >= 0.95";
      } else if (quotaUtilization >= 0.8) {
        status = "warn";
        alertThreshold = "quotaUtilization >= 0.80";
      }

      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        rateLimitCeiling: mauLimit,
        quotaUtilization,
        status,
        alertThreshold,
        detail: `${totalUsers.toLocaleString()} total users / ${mauLimit.toLocaleString()} MAU limit`,
      };
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Clerk probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
