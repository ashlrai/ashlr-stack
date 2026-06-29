/**
 * Auth0 Management API quota + rate-limit probe.
 *
 * Calls:
 *   POST /oauth/token   — exchange M2M client credentials for an access token
 *   GET  /api/v2/stats/daily — daily active user count (last 1 day)
 *
 * Quota endpoint:
 *   Auth0 Management API v2 does not expose a dedicated quota endpoint.
 *   Instead we check the token endpoint liveness and inspect the
 *   `x-ratelimit-limit` / `x-ratelimit-remaining` headers returned on any
 *   Management API call.
 *
 * Reference: https://auth0.com/docs/api/management/v2
 * Dashboard:  https://manage.auth0.com
 *
 * Credentials required: AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
 *
 * Caveats:
 *   - Rate limits on the Management API are per-second and per-minute depending
 *     on the endpoint. The header we surface is the per-minute ceiling on
 *     GET /api/v2/stats/daily.
 *   - The Machine-to-Machine app must have the "read:stats" permission granted
 *     in Auth0 → Applications → APIs → Machine to Machine Applications.
 *   - Daily Active Users (DAU) in /stats/daily counts logins, not seats;
 *     it is therefore a proxy for API-key burn, not hard quota exhaustion.
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "auth0";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Auth0 Management API rate-limit",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const domain = await tryRevealSecret("AUTH0_DOMAIN");
    const clientId = await tryRevealSecret("AUTH0_CLIENT_ID");
    const clientSecret = await tryRevealSecret("AUTH0_CLIENT_SECRET");

    if (!domain || !clientId || !clientSecret) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail:
          "AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET all required — probe skipped",
      };
    }

    const start = Date.now();
    try {
      // Step 1: obtain a Management API access token via client_credentials.
      const tokenRes = await fetch(`https://${domain}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          audience: `https://${domain}/api/v2/`,
        }),
        signal: ctx.signal,
      });

      if (!tokenRes.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          status: "error",
          detail: `Auth0 /oauth/token returned HTTP ${tokenRes.status}`,
        };
      }

      const tokenBody = (await tokenRes.json()) as { access_token?: string };
      const accessToken = tokenBody.access_token;
      if (!accessToken) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          status: "error",
          detail: "Auth0 token response missing access_token",
        };
      }

      // Step 2: call GET /api/v2/stats/daily to surface rate-limit headers.
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const statsRes = await fetch(
        `https://${domain}/api/v2/stats/daily?from=${today}&to=${today}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          signal: ctx.signal,
        },
      );
      const latencyMs = Date.now() - start;

      if (!statsRes.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Auth0 /api/v2/stats/daily returned HTTP ${statsRes.status}`,
        };
      }

      // Surface rate-limit ceiling from Management API headers.
      // Header: x-ratelimit-limit / x-ratelimit-remaining (per-minute window).
      const limitStr = statsRes.headers.get("x-ratelimit-limit");
      const remainingStr = statsRes.headers.get("x-ratelimit-remaining");

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
        detail: "Auth0 Management API reachable",
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
        detail: `Auth0 probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
