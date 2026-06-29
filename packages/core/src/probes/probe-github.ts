/**
 * GitHub API rate-limit probe.
 *
 * Calls GET /rate_limit and surfaces:
 *   - rateLimitCeiling: core.limit (requests per hour)
 *   - quotaUtilization: fraction of core quota consumed
 *   - latencyMs
 *
 * Warns at >= 80% utilization; errors at >= 95%.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "github";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "GitHub API rate-limit remaining",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("GITHUB_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "GITHUB_TOKEN not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.github.com/rate_limit", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ashlr-stack-probe",
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
          detail: `GitHub /rate_limit returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as {
        resources: { core: { limit: number; remaining: number; used: number } };
      };
      const core = body.resources?.core;
      if (!core) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Unexpected GitHub /rate_limit response shape",
        };
      }

      const utilization = core.limit > 0 ? core.used / core.limit : 0;
      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;

      if (utilization >= ERROR_THRESHOLD) {
        status = "error";
        alertThreshold = `quotaUtilization >= ${ERROR_THRESHOLD}`;
      } else if (utilization >= WARN_THRESHOLD) {
        status = "warn";
        alertThreshold = `quotaUtilization >= ${WARN_THRESHOLD}`;
      }

      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        rateLimitCeiling: core.limit,
        quotaUtilization: utilization,
        status,
        alertThreshold,
        detail: `core: ${core.remaining}/${core.limit} remaining`,
      };
    } catch (err) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        status: "error",
        detail: `GitHub probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
