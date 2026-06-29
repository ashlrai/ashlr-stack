/**
 * Railway infrastructure health-check probe.
 *
 * Calls the Railway GraphQL API to validate the token and surface account info.
 *
 * Reference: https://docs.railway.app/reference/public-api
 * Dashboard:  https://railway.app/dashboard
 *
 * Credentials required: RAILWAY_TOKEN
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "railway";
const WARN_THRESHOLD = 0.8;
const ERROR_THRESHOLD = 0.95;

const probe: Probe = {
  provider: PROVIDER,
  label: "Railway API health-check",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const token = await tryRevealSecret("RAILWAY_TOKEN");
    if (!token) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "RAILWAY_TOKEN not in vault — probe skipped",
      };
    }

    const query = `query { me { id email name } }`;

    const start = Date.now();
    try {
      const res = await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: ctx.signal,
      });
      const latencyMs = Date.now() - start;

      if (res.status === 401 || res.status === 403) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Railway GraphQL returned HTTP ${res.status} — check RAILWAY_TOKEN`,
        };
      }

      if (res.status === 429) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: "Railway API rate-limited (HTTP 429)",
        };
      }

      if (!res.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Railway GraphQL returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as {
        data?: { me?: { id?: string; email?: string; name?: string } };
        errors?: Array<{ message: string }>;
      };

      if (body.errors?.length) {
        const errMsg = body.errors[0]?.message ?? "unknown GraphQL error";
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Railway GraphQL error: ${errMsg}`,
        };
      }

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

      const email = body.data?.me?.email;
      const detail = email ? `Railway API reachable (user: ${email})` : "Railway API reachable";

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
        detail: `Railway probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
