/**
 * Mailgun email API health-check probe.
 *
 * Calls GET /v3/domains to validate the API key and surface rate-limit headers.
 * Mailgun uses HTTP Basic auth with "api" as username and the API key as password.
 *
 * Reference: https://documentation.mailgun.com/docs/mailgun/api-reference/
 * Dashboard:  https://app.mailgun.com
 *
 * Credentials required: MAILGUN_API_KEY
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "mailgun";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Mailgun domain list health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const apiKey = await tryRevealSecret("MAILGUN_API_KEY");
    if (!apiKey) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "MAILGUN_API_KEY not in vault — probe skipped",
      };
    }

    // Mailgun uses HTTP Basic auth: username="api", password=apiKey.
    const credentials = btoa(`api:${apiKey}`);

    const start = Date.now();
    try {
      const res = await fetch("https://api.mailgun.net/v3/domains?limit=1", {
        headers: {
          Authorization: `Basic ${credentials}`,
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
          detail: `Mailgun /v3/domains returned HTTP ${res.status} — check MAILGUN_API_KEY`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Mailgun API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Mailgun /v3/domains returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as { items?: unknown[]; total_count?: number };
      const domainCount = body.total_count ?? body.items?.length ?? 0;

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
        detail: `Mailgun API reachable (${domainCount} domain(s))`,
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
        detail: `Mailgun probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
