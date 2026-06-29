/**
 * SendGrid high-volume transactional email health-check probe.
 *
 * Calls GET /v3/scopes to validate the API key and surface available permissions.
 *
 * Reference: https://docs.sendgrid.com/api-reference
 * Dashboard:  https://app.sendgrid.com
 *
 * Credentials required: SENDGRID_API_KEY
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "sendgrid";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "SendGrid API key health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("SENDGRID_API_KEY");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "SENDGRID_API_KEY not in vault — probe skipped",
      };
    }

    const start = Date.now();
    try {
      const res = await fetch("https://api.sendgrid.com/v3/scopes", {
        headers: {
          Authorization: `Bearer ${token}`,
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
          detail: `SendGrid /v3/scopes returned HTTP ${res.status} — check SENDGRID_API_KEY`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "SendGrid API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `SendGrid /v3/scopes returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as { scopes?: string[] };
      const scopeCount = body.scopes?.length ?? 0;

      // SendGrid rate-limit headers: X-RateLimit-Limit, X-RateLimit-Remaining
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

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail: `SendGrid API key valid (${scopeCount} scope(s))`,
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
        detail: `SendGrid probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
