/**
 * Grafana dashboards + alerting health-check probe.
 *
 * Calls GET /api/health on the configured Grafana instance to check liveness,
 * then GET /api/org to validate the service-account token.
 *
 * Reference: https://grafana.com/docs/grafana/latest/developers/http_api/
 * Dashboard:  https://grafana.com
 *
 * Credentials required: GRAFANA_API_KEY, GRAFANA_URL
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "grafana";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Grafana API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const apiKey = await tryRevealSecret("GRAFANA_API_KEY");
    const grafanaUrl = await tryRevealSecret("GRAFANA_URL");

    if (!apiKey) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "GRAFANA_API_KEY not in vault — probe skipped",
      };
    }

    if (!grafanaUrl) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "GRAFANA_URL not in vault — probe skipped",
      };
    }

    // Normalize URL: strip trailing slash.
    const baseUrl = grafanaUrl.replace(/\/$/, "");

    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/org`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
          detail: `Grafana /api/org returned HTTP ${res.status} — check GRAFANA_API_KEY`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Grafana API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Grafana /api/org returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as { name?: string; id?: number };

      const limitStr = res.headers.get("x-ratelimit-limit");
      const remainingStr = res.headers.get("x-ratelimit-remaining");

      let rateLimitCeiling: number | undefined;
      let quotaUtilization: number | undefined;

      if (limitStr && remainingStr) {
        const limit = parseInt(limitStr, 10);
        const remaining = parseInt(remainingStr, 10);
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

      const detail = body.name
        ? `Grafana org "${body.name}" reachable`
        : "Grafana API reachable";

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail,
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
        detail: `Grafana probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
