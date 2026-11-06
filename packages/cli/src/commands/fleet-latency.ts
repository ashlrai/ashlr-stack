import { execFile } from "node:child_process";
import { defineCommand } from "citty";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";

const WINDOW_MS = 6 * 60 * 60 * 1000;
export const locusGh: GhRunner = (args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      "locus",
      ["exec", "--", "gh", ...args],
      { signal, timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/** Linear interpolation at (n - 1) * p; the median averages the middle pair. */
export function percentile(values: number[], p: number): number | null {
  if (!Number.isFinite(p) || p < 0 || p > 1 || values.some((v) => !Number.isFinite(v) || v < 0))
    throw new Error("Invalid percentile input");
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return sorted[lower]! + (sorted[Math.ceil(index)]! - sorted[lower]!) * (index - lower);
}

/** Read closed PRs by update time so older PRs merged in the window are included. */
export async function collectFleetLatency(runner: GhRunner = locusGh, now = Date.now()) {
  const since = now - WINDOW_MS;
  const repos = await Promise.all(
    DOCTOR_REPOS.map(async (repo) => {
      const durations: number[] = [];
      const unavailable = {
        repo,
        status: "unavailable",
        count: null,
        medianSeconds: null,
        p90Seconds: null,
      };
      const signal = AbortSignal.timeout(10000);
      try {
        for (let page = 1; ; page++) {
          const rows: unknown = JSON.parse(
            await runner(
              [
                "api",
                `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
              ],
              signal,
            ),
          );
          if (!Array.isArray(rows)) return unavailable;
          let reachedStart = false;
          for (const row of rows) {
            if (!row || typeof row !== "object") return unavailable;
            const updated =
              typeof row.updated_at === "string" ? Date.parse(row.updated_at) : Number.NaN;
            if (!Number.isFinite(updated)) return unavailable;
            if (updated < since) {
              reachedStart = true;
              continue;
            }
            if (row.merged_at === null) continue;
            const merged =
              typeof row.merged_at === "string" ? Date.parse(row.merged_at) : Number.NaN;
            if (!Number.isFinite(merged)) return unavailable;
            if (merged < since || merged > now) continue;
            const opened =
              typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
            if (!Number.isFinite(opened) || opened > merged) return unavailable;
            durations.push((merged - opened) / 1000);
          }
          if (reachedStart || rows.length < 100) break;
          if (signal.aborted) return unavailable;
        }
        return {
          repo,
          status: "ok",
          count: durations.length,
          medianSeconds: percentile(durations, 0.5),
          p90Seconds: percentile(durations, 0.9),
        };
      } catch {
        return unavailable;
      }
    }),
  );
  return {
    schemaVersion: 1,
    windowStart: new Date(since).toISOString(),
    windowEnd: new Date(now).toISOString(),
    repos,
  };
}

export const fleetLatencyCommand = defineCommand({
  meta: {
    name: "fleet-latency",
    description:
      "Report per-repo median and p90 open-to-merge seconds for PRs merged in the last six hours.",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit schemaVersion 1 JSON; missing percentiles are null.",
    },
  },
  async run({ args }) {
    const report = await collectFleetLatency();
    if (args.json) console.log(JSON.stringify(report));
    else
      for (const r of report.repos)
        console.log(
          `${r.repo}: ${r.status}, n=${r.count ?? "unknown"}, median=${r.medianSeconds ?? "unknown"}s, p90=${r.p90Seconds ?? "unknown"}s`,
        );
  },
});
