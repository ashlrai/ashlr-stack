import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import { type FleetRow, isFleetRow, readFleetJsonl } from "../lib/fleet-jsonl.ts";

const name = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(v);
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const time = (r: FleetRow) => {
  const value = r.timestamp ?? r.ts;
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
};

/** JSONL or the timestamped key=value format used by dispatchd; never emit raw lines. */
function parse(line: string): FleetRow | null {
  try {
    const row: unknown = JSON.parse(line);
    return isFleetRow(row) ? row : null;
  } catch {
    const head = /^(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?Z?)\s+(\S+)\s*(.*)$/.exec(line);
    if (!head) return null;
    const row: FleetRow = Object.assign(Object.create(null), {
      timestamp: head[1],
      event: head[2],
    });
    for (const m of head[3]!.matchAll(/(\w+)=("[^"\r\n]*"|\S+)/g)) {
      try {
        row[m[1]!] = JSON.parse(m[2]!);
      } catch {
        row[m[1]!] = m[2];
      }
    }
    if (["ok", "error", "failed", "timeout", "non-ok"].includes(head[2]!)) row.status = head[2];
    return row;
  }
}

/** Timestamped or launch/tick rows need a real time; counters need nonnegative integers. */
const wellFormed = (row: FleetRow) =>
  !(
    ((row.timestamp !== undefined ||
      row.ts !== undefined ||
      row.event === "launch" ||
      row.event === "tick") &&
      !Number.isFinite(time(row))) ||
    (row.status !== undefined && typeof row.status !== "string") ||
    (row.event === "tick" && !count(row.launched)) ||
    ((row.need !== undefined || row.picked !== undefined) &&
      (!count(row.need) || !count(row.picked)))
  );

export async function collectFleetSilent(runs: string, now = Date.now()) {
  const sources: Record<string, string> = {};
  let authors: string[] = [];
  try {
    authors = (await readdir(runs)).filter((s) => /^[\w.-]*author[\w.-]*\.log$/.test(s)).sort();
    sources.authors = authors.length ? "ok" : "missing";
  } catch {
    sources.authors = "unavailable";
  }
  const paths = [...authors, "dispatchd.log", "dispatch-events.log", "metrics/jobs.jsonl"];
  // Bounded, regular-file reads only; missing/invalid inputs never mean a healthy fleet.
  const inputs = await Promise.all(
    paths.map((path) =>
      readFleetJsonl(join(runs, path), {
        parseLine: parse,
        malformedLines: "flag",
        flagRow: wellFormed,
      }),
    ),
  );
  const findings: FleetRow[] = [];
  const lanes = new Map<string, FleetRow>();
  const finishes = new Map<string, FleetRow[]>();
  const fixups = new Map<string, Set<string>>();
  let firstActivity = now;
  let lastLaunch: number | null = null;
  for (const [i, input] of inputs.entries()) {
    const path = paths[i]!;
    sources[path] = input.status;
    // An unreadable newer record could reverse a latest/absence claim.
    if (input.status !== "ok") continue;
    let lastAuthor: FleetRow | undefined;
    // Legacy untimestamped logs use append order; fully dated logs use event time.
    if (input.rows.every((row) => Number.isFinite(time(row))))
      input.rows.sort((a, b) => time(a) - time(b));
    for (const row of input.rows) {
      const at = time(row);
      if (at > now) continue;
      if (authors.includes(path) && typeof row.status === "string") lastAuthor = row;
      const lane = row.lane ?? row.pool;
      if (name(lane) && count(row.need) && count(row.picked)) {
        const previous = lanes.get(lane);
        if (!previous || !Number.isFinite(time(previous)) || !(time(previous) > at))
          lanes.set(lane, row);
      }
      if (path === "metrics/jobs.jsonl" && row.event === "finish" && name(lane)) {
        const rows = finishes.get(lane) ?? [];
        rows.push(row);
        finishes.set(lane, rows.slice(-10));
      }
      if (authors.includes(path) || !Number.isFinite(at)) continue;
      firstActivity = Math.min(firstActivity, at);
      if (
        row.event === "launch" ||
        (row.event === "tick" && count(row.launched) && Number(row.launched) > 0)
      ) {
        lastLaunch = Math.max(lastLaunch ?? at, at);
        const job = row.job ?? row.jobId ?? row.job_id ?? row.id;
        // Only launches count as reuse: a finish after midnight is the same execution.
        if (row.event === "launch" && name(job) && job.includes("FIXUP")) {
          const days = fixups.get(job) ?? new Set<string>();
          days.add(new Date(at).toISOString().slice(0, 10));
          fixups.set(job, days);
        }
      }
    }
    if (lastAuthor && lastAuthor.status !== "ok")
      findings.push({ rule: "author-non-ok", author: path });
    if (authors.includes(path) && !lastAuthor) sources[path] = "unrecognized";
  }
  for (const [lane, row] of [...lanes].sort(([a], [b]) => a.localeCompare(b)))
    if (
      !inputs.some((input) => input.status === "invalid") &&
      Number(row.need) > 0 &&
      row.picked === 0
    )
      findings.push({ rule: "need-without-picks", lane, need: row.need, picked: 0 });
  for (const [lane, rows] of [...finishes].sort(([a], [b]) => a.localeCompare(b)))
    if (rows.length === 10 && rows.every((r) => r.empty === true))
      findings.push({ rule: "ten-empty-finishes", lane });
  if (
    !inputs.slice(authors.length).some((input) => input.status === "invalid") &&
    now - (lastLaunch ?? firstActivity) >= 20 * 60000
  )
    findings.push({
      rule: "no-launch-20m",
      lastLaunchAt: lastLaunch === null ? null : new Date(lastLaunch).toISOString(),
    });
  for (const [jobId, days] of [...fixups].sort(([a], [b]) => a.localeCompare(b)))
    if (days.size > 1) findings.push({ rule: "fixup-id-reused", jobId, days: [...days].sort() });
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), sources, findings };
}

export const fleetSilentCommand = defineCommand({
  meta: {
    name: "fleet-silent",
    description: "Name silent fleet failures in author, dispatch and job logs (read-only JSON).",
  },
  args: {
    runs: { type: "string", description: "Runs directory (default: ~/.ashlr-runs)." },
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON (also the default)." },
  },
  async run({ args }) {
    console.log(
      JSON.stringify(await collectFleetSilent(args.runs ?? join(homedir(), ".ashlr-runs"))),
    );
  },
});
