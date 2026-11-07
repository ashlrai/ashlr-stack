import { homedir } from "node:os";
import { join } from "node:path";
import { readFleetJsonl } from "../packages/cli/src/lib/fleet-jsonl.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const name = (value: unknown) => (typeof value === "string" && NAME.test(value) ? value : "unknown");
const timestamp = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? Date.parse(value)
    : Number.NaN;

type Group = { lane: string; repo: string; launches: number; reaps: number; publishes: number; prs: number; merged: number; mergeYield: number | null };

/** Publish cohort: distinct PR URLs published in the window, matched to outcomes as of end. */
export async function fleetMetrics(path: string, start: string, end: string) {
  const from = timestamp(start);
  const to = timestamp(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("Invalid window");
  const source = await readFleetJsonl(path, { maxBytes: 32 * 1024 * 1024, requireInitialSize: true });
  if (source.status !== "ok") throw new Error("Cannot read metrics: expected a valid regular JSONL file of at most 32 MiB");
  const groups = new Map<string, Group>();
  const prs = new Map<string, Set<Group>>();
  const merged = new Set<string>();
  const failures = new Map<string, number>();
  let invalidTimestamps = 0;
  for (const row of source.rows) {
    if (!["launch", "finish", "reap", "publish", "outcome", "precheck_skip"].includes(String(row.event))) continue;
    const time = timestamp(row.ts ?? row.timestamp);
    if (!Number.isFinite(time)) { invalidTimestamps++; continue; }
    if (time > to) continue;
    if (row.event === "outcome" && row.state === "MERGED" && typeof row.url === "string") merged.add(row.url);
    if (time < from || row.event === "outcome") continue;
    const lane = name(row.lane);
    const repo = name(row.repo);
    const key = JSON.stringify([lane, repo]);
    let group = groups.get(key);
    if (!group) { group = { lane, repo, launches: 0, reaps: 0, publishes: 0, prs: 0, merged: 0, mergeYield: null }; groups.set(key, group); }
    if (row.event === "launch") group.launches++;
    if (row.event === "finish" || row.event === "reap") group.reaps++;
    if (row.event === "publish") {
      group.publishes++;
      if (row.class === "pr" && typeof row.url === "string" && row.url.length > 0 && row.url.length <= 2048) {
        const owners = prs.get(row.url) ?? new Set<Group>();
        owners.add(group); prs.set(row.url, owners);
      }
    }
    const signature = row.event === "precheck_skip" ? "precheck_skip" :
      (row.event === "finish" || row.event === "reap") && row.empty === true ? "empty_finish" :
      row.event === "publish" && row.class === "empty" ? "empty_publish" :
      row.event === "publish" && row.class === "error" ? "publish_error" : null;
    if (signature) failures.set(signature, (failures.get(signature) ?? 0) + 1);
  }
  for (const [url, owners] of prs) for (const group of owners) { group.prs++; if (merged.has(url)) group.merged++; }
  for (const group of groups.values()) group.mergeYield = group.prs ? group.merged / group.prs : null;
  return {
    schemaVersion: 1, windowStart: new Date(from).toISOString(), windowEnd: new Date(to).toISOString(), invalidTimestamps,
    groups: [...groups.values()].sort((a, b) => a.lane.localeCompare(b.lane) || a.repo.localeCompare(b.repo)),
    failureSignatures: [...failures].map(([signature, count]) => ({ signature, count })).sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 2 && args.length !== 3) {
    console.error("Usage: bun scripts/fleet-metrics.ts <start ISO> <end ISO> [metrics JSONL]");
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await fleetMetrics(args[2] ?? join(homedir(), ".ashlr-runs/metrics/jobs.jsonl"), args[0]!, args[1]!), null, 2));
    } catch {
      console.error("Cannot summarize metrics: check the ISO window and readable JSONL source (maximum 32 MiB).");
      process.exitCode = 1;
    }
  }
}
