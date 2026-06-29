/**
 * Vercel build minutes + function invocations probe.
 *
 * Calls:
 *   GET /v2/teams/{teamId}/usage  — build minutes, function invocations
 *   GET /v2/user                  — resolves teamId when not set
 *
 * Requires VERCEL_TOKEN. VERCEL_TEAM_ID is optional; without it, we use the
 * personal account.
 *
 * Warns when build minute or function invocation utilization exceeds 80% of
 * the Hobby plan limits (6,000 build minutes / month, 100k invocations/day).
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "vercel";

// Hobby plan soft limits used as reference for utilization %.
const HOBBY_BUILD_MINUTES_MONTHLY = 6_000;
const HOBBY_FUNCTIONS_DAILY = 100_000;

const probe: Probe = {
  provider: PROVIDER,
  label: "Vercel build minutes + function invocations",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("VERCEL_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "VERCEL_TOKEN not in vault — probe skipped",
      };
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();
    try {
      // Resolve team id (optional).
      let teamId = await tryRevealSecret("VERCEL_TEAM_ID");
      if (!teamId) {
        const userRes = await fetch("https://api.vercel.com/v2/user", {
          headers,
          signal: ctx.signal,
        });
        if (userRes.ok) {
          const user = (await userRes.json()) as { user?: { id?: string } };
          teamId = user.user?.id;
        }
      }

      const usageUrl = teamId
        ? `https://api.vercel.com/v2/teams/${teamId}/usage`
        : "https://api.vercel.com/v2/user/usage";

      const usageRes = await fetch(usageUrl, { headers, signal: ctx.signal });
      const latencyMs = Date.now() - start;

      if (!usageRes.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Vercel usage API returned HTTP ${usageRes.status}`,
        };
      }

      const usage = (await usageRes.json()) as {
        buildMinutesUsed?: number;
        buildMinutesAllowed?: number;
        functionExecutionUnitsUsed?: number;
        functionExecutionUnitsAllowed?: number;
      };

      const buildMins = usage.buildMinutesUsed ?? 0;
      const buildMinsLimit = usage.buildMinutesAllowed ?? HOBBY_BUILD_MINUTES_MONTHLY;
      const fnInvocations = usage.functionExecutionUnitsUsed ?? 0;
      const fnLimit = usage.functionExecutionUnitsAllowed ?? HOBBY_FUNCTIONS_DAILY;

      const buildUtil = buildMinsLimit > 0 ? buildMins / buildMinsLimit : 0;
      const fnUtil = fnLimit > 0 ? fnInvocations / fnLimit : 0;
      const quotaUtilization = Math.max(buildUtil, fnUtil);

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
        quotaUtilization,
        status,
        alertThreshold,
        detail: `build: ${buildMins}/${buildMinsLimit} min, functions: ${fnInvocations}/${fnLimit}`,
      };
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Vercel probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
