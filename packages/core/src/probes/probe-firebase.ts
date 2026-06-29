/**
 * Firebase Realtime Database connection count probe.
 *
 * Calls the Firebase REST API to check active connections:
 *   GET {databaseURL}/.info/connected.json   — simple liveness
 *   GET {databaseURL}/.info/serverTimeOffset.json — latency measure
 *
 * The free Spark plan allows 100 simultaneous connections. To probe actual
 * connection count we inspect the admin SDK via the REST interface at
 * /.info/stats (only available for Realtime DB projects with admin access).
 *
 * Requires FIREBASE_DATABASE_URL and FIREBASE_SERVICE_ACCOUNT_JSON
 * (or FIREBASE_API_KEY for limited liveness-only check).
 */

import { tryRevealSecret } from "../providers/_helpers.ts";
import type { Probe, ProbeContext, ProbeResult } from "./types.ts";

const PROVIDER = "firebase";
const FREE_TIER_CONNECTIONS = 100;

const probe: Probe = {
  provider: PROVIDER,
  label: "Firebase Realtime DB connection count",

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const databaseUrl = await tryRevealSecret("FIREBASE_DATABASE_URL");
    const serviceAccountJson = await tryRevealSecret("FIREBASE_SERVICE_ACCOUNT_JSON");

    if (!databaseUrl) {
      return {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "skipped",
        detail: "FIREBASE_DATABASE_URL not in vault — probe skipped",
      };
    }

    const baseUrl = databaseUrl.replace(/\/$/, "");
    const start = Date.now();

    try {
      // Liveness: GET /.info/serverTimeOffset.json
      const livenessUrl = `${baseUrl}/.info/serverTimeOffset.json`;
      const livenessRes = await fetch(livenessUrl, { signal: ctx.signal });
      const latencyMs = Date.now() - start;

      if (!livenessRes.ok) {
        return {
          provider: PROVIDER,
          probedAt: new Date().toISOString(),
          latencyMs,
          status: "error",
          detail: `Firebase liveness check returned HTTP ${livenessRes.status}`,
        };
      }

      // Attempt to read connection stats if service account is available.
      let connectionCount: number | undefined;
      if (serviceAccountJson) {
        try {
          const sa = JSON.parse(serviceAccountJson) as { project_id?: string };
          if (sa.project_id) {
            // .info/clients shows active connection count in admin SDK REST mode.
            // This requires auth — we do a best-effort read with no auth for now
            // (public rules projects only). Real admin auth requires JWT minting.
            const statsRes = await fetch(`${baseUrl}/.info/clients.json?shallow=true`, {
              signal: ctx.signal,
            });
            if (statsRes.ok) {
              const stats = (await statsRes.json()) as number | null;
              if (typeof stats === "number") connectionCount = stats;
            }
          }
        } catch {
          // Service account parse failure is non-fatal.
        }
      }

      let quotaUtilization: number | undefined;
      if (connectionCount !== undefined) {
        quotaUtilization = connectionCount / FREE_TIER_CONNECTIONS;
      }

      let status: ProbeResult["status"] = "ok";
      let alertThreshold: string | undefined;

      if (quotaUtilization !== undefined && quotaUtilization >= 0.95) {
        status = "error";
        alertThreshold = "connectionCount >= 95% of free tier limit";
      } else if (quotaUtilization !== undefined && quotaUtilization >= 0.8) {
        status = "warn";
        alertThreshold = "connectionCount >= 80% of free tier limit";
      }

      const result: ProbeResult = {
        provider: PROVIDER,
        probedAt: new Date().toISOString(),
        latencyMs,
        status,
        detail:
          connectionCount !== undefined
            ? `${connectionCount}/${FREE_TIER_CONNECTIONS} connections`
            : "Firebase RTDB reachable (connection count unavailable without admin auth)",
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
        detail: `Firebase probe failed: ${(err as Error).message}`,
      };
    }
  },
};

export default probe;
