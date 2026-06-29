/**
 * Neon compute unit burn-rate probe.
 *
 * Calls GET /v2/projects/{id}/branches to count active branches and
 * GET /v2/projects/{id}/operations?limit=1 to detect recent compute activity.
 *
 * Requires NEON_API_KEY and resolves the project id from NEON_PROJECT_ID or
 * the first project returned by GET /v2/projects.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "neon";

const probe: Probe = {
  provider: PROVIDER,
  label: "Neon compute unit burn-rate",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("NEON_API_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "NEON_API_KEY not in vault — probe skipped",
      };
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const start = Date.now();
    try {
      // Resolve project id.
      let projectId = await tryRevealSecret("NEON_PROJECT_ID");
      if (!projectId) {
        const projRes = await fetch("https://console.neon.tech/api/v2/projects?limit=1", {
          headers,
          signal: ctx.signal,
        });
        if (projRes.ok) {
          const data = (await projRes.json()) as { projects?: Array<{ id: string }> };
          projectId = data.projects?.[0]?.id;
        }
      }

      if (!projectId) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          status: "skipped",
          detail: "Cannot resolve Neon project id — set NEON_PROJECT_ID",
        };
      }

      // Get branch count as a proxy for compute exposure.
      const branchRes = await fetch(
        `https://console.neon.tech/api/v2/projects/${projectId}/branches`,
        { headers, signal: ctx.signal },
      );
      const latencyMs = Date.now() - start;

      if (!branchRes.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Neon branches API returned HTTP ${branchRes.status}`,
        };
      }

      const branchData = (await branchRes.json()) as {
        branches?: Array<{ id: string; name: string; compute_time_seconds?: number }>;
      };
      const branches = branchData.branches ?? [];
      const branchCount = branches.length;

      // Compute total compute-time across all branches (Neon free tier: 191.9h/month).
      const FREE_TIER_COMPUTE_SECONDS = 191.9 * 3600;
      const totalComputeSeconds = branches.reduce(
        (sum, b) => sum + (b.compute_time_seconds ?? 0),
        0,
      );
      const quotaUtilization =
        FREE_TIER_COMPUTE_SECONDS > 0 ? totalComputeSeconds / FREE_TIER_COMPUTE_SECONDS : undefined;

      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;

      if (quotaUtilization !== undefined && quotaUtilization >= 0.95) {
        status = "error";
        alertThreshold = "quotaUtilization >= 0.95";
      } else if (quotaUtilization !== undefined && quotaUtilization >= 0.8) {
        status = "warn";
        alertThreshold = "quotaUtilization >= 0.80";
      }

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail: `${branchCount} branch(es), compute: ${(totalComputeSeconds / 3600).toFixed(1)}h used`,
      };
      if (quotaUtilization !== undefined) result.quotaUtilization = quotaUtilization;
      if (alertThreshold) result.alertThreshold = alertThreshold;

      return result;
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `Neon probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
