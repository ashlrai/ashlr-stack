import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";

type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const URL = /^https:\/\/[\w./%+-]{1,300}$/;
/** `- STATUS [hh:mm] [lane] JOBID [r<n>] (attrs): text` — the same shape restock.py reads. */
const HEAD =
  /^- ([A-Z][A-Z-]*?) (?:\d\d:\d\d )?(?:[a-z-]+ )?(?:[a-z-]+ )?([A-Za-z0-9][A-Za-z0-9._-]+)(?: r\d+)? \((.*?)\):?/;
const LANDED = new Set(["MERGED", "LANDED", "DONE"]);
const CAP = 32 * 1024 * 1024;
export const BET_STATUSES = ["merged", "open", "empty", "running", "waiting", "vanished"] as const;
export type BetStatus = (typeof BET_STATUSES)[number];

/** Fixed public state files only; refuse links. Metrics tail-reads, others cap out. */
async function source(path: string, tail = false) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (!tail && stat.size > CAP)) throw new Error();
      let text: string;
      if (tail && stat.size > CAP) {
        const buffer = Buffer.alloc(CAP);
        const { bytesRead } = await file.read(buffer, 0, CAP, stat.size - CAP);
        const chunk = buffer.subarray(0, bytesRead).toString("utf8");
        const nl = chunk.indexOf("\n");
        text = nl < 0 ? "" : chunk.slice(nl + 1); // drop the split first line
      } else text = await file.readFile("utf8");
      return { status: "ok", text };
    } finally {
      await file.close();
    }
  } catch (error) {
    return {
      status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid",
      text: "",
    };
  }
}

/** Latest leader ledger line wins; a bet is a job id whose attrs carry `src=<src>`. */
export function leaderBets(ledger: string, src: string) {
  const bets = new Map<string, { status: string; pool: string | null }>();
  for (const line of ledger.split("\n")) {
    const m = HEAD.exec(line);
    if (!m || !ID.test(m[2]!)) continue;
    if (/\bsrc=([^\s,)]+)/.exec(m[3]!)?.[1] !== src) continue;
    bets.set(m[2]!, { status: m[1]!, pool: /\bpool=([a-z-]+)/.exec(m[3]!)?.[1] ?? null });
  }
  return bets;
}

interface Evidence {
  queued: boolean;
  lane: string | null;
  launched: boolean;
  finished: boolean;
  empty: boolean;
  publish: string | null;
  url: string | null;
  outcome: string | null;
}

const blank = (): Evidence => ({
  queued: false,
  lane: null,
  launched: false,
  finished: false,
  empty: false,
  publish: null,
  url: null,
  outcome: null,
});

/** A bet settles only at merge; every other terminal trace is an empty return. */
function classify(e: Evidence, leader: string | null): BetStatus {
  if (e.outcome === "MERGED") return "merged";
  if (e.outcome !== null && e.outcome !== "OPEN") return "empty";
  if (e.outcome === "OPEN" || e.publish === "pr") return "open";
  if (e.empty || e.publish === "empty") return "empty";
  if (e.finished || e.publish !== null) return "open"; // work produced, PR unresolved
  if (e.launched) return "running";
  if (e.queued || leader === "READY") return "waiting";
  if (leader !== null && LANDED.has(leader)) return "merged";
  if (leader === "PR-OPEN") return "open";
  return "vanished"; // claimed bets with no trace vanished between queue and launch
}

export async function collectFleetBets(
  queue: string,
  options: { router?: string; ready?: string; metrics?: string; src?: string } = {},
) {
  const runs = dirname(queue);
  const [router, ready, metrics] = await Promise.all([
    source(options.router ?? join(queue, "router-queue.md")),
    source(options.ready ?? join(queue, "ready.tsv")),
    source(options.metrics ?? join(runs, "metrics", "jobs.jsonl"), true),
  ]);
  const src = options.src ?? "leader";
  const ledger = router.status === "ok" ? leaderBets(router.text, src) : new Map();
  const outcomeByUrl = new Map<string, string>();
  const evidence = new Map<string, Evidence>();
  for (const line of metrics.text.split("\n")) {
    let row: Row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record(row)) continue;
    if (row.event === "outcome" && typeof row.url === "string")
      outcomeByUrl.set(row.url, typeof row.state === "string" ? row.state : "");
    const job = typeof row.job === "string" && ID.test(row.job) ? row.job : null;
    if (!job || !ledger.has(job)) continue;
    const e = evidence.get(job) ?? blank();
    evidence.set(job, e);
    if (typeof row.lane === "string" && /^[a-z-]{1,40}$/.test(row.lane)) e.lane ??= row.lane;
    if (row.event === "launch") e.launched = true;
    else if (row.event === "finish") {
      e.finished = true;
      if (row.empty === true) e.empty = true;
    } else if (row.event === "publish") {
      e.publish = typeof row.class === "string" ? row.class : "unknown";
      if (typeof row.url === "string" && URL.test(row.url)) e.url = row.url;
    } else if (row.event === "outcome" && typeof row.state === "string") {
      if (e.outcome !== "MERGED") e.outcome = row.state;
    } else if (row.event === "precheck_skip") e.empty = true; // done-noop: launched nothing
  }
  for (const line of ready.text.split("\n")) {
    const fields = line.split("\t");
    if (!ID.test(fields[0] ?? "") || !ledger.has(fields[0]!)) continue;
    const e = evidence.get(fields[0]!) ?? blank();
    evidence.set(fields[0]!, e);
    e.queued = true;
    if (/^[a-z-]{1,40}$/.test(fields[2] ?? "")) e.lane ??= fields[2]!;
  }
  const bets = [...ledger.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, bet]) => {
      const e = evidence.get(id) ?? blank();
      // The URL-keyed outcome names the PR itself; it outranks a stale job-keyed row.
      if (e.url !== null) e.outcome = outcomeByUrl.get(e.url) ?? e.outcome;
      const status = classify(e, bet.status);
      return {
        id,
        status,
        lane: e.lane ?? bet.pool,
        url: e.url,
        leaderStatus: bet.status,
        evidence: {
          queued: e.queued,
          launched: e.launched,
          finished: e.finished,
          empty: e.empty,
          publishClass: e.publish,
          outcome: e.outcome,
        },
      };
    });
  const tally = (rows: typeof bets) => {
    const counts = Object.fromEntries(BET_STATUSES.map((s) => [s, 0])) as Record<BetStatus, number>;
    for (const row of rows) counts[row.status]++;
    const resolved = counts.merged + counts.empty;
    return {
      bets: rows.length,
      ...counts,
      resolved,
      mergedRate: resolved ? Math.round((counts.merged / resolved) * 1000) / 1000 : null,
    };
  };
  const lanes = new Map<string | null, typeof bets>();
  for (const bet of bets) lanes.set(bet.lane, [...(lanes.get(bet.lane) ?? []), bet]);
  return {
    schemaVersion: 1,
    src,
    sources: { router: router.status, ready: ready.status, metrics: metrics.status },
    totals: tally(bets),
    lanes: [...lanes.entries()]
      .sort(([a], [b]) => (a ?? "~").localeCompare(b ?? "~"))
      .map(([lane, rows]) => ({ lane, ...tally(rows) })),
    bets,
  };
}

export const fleetBetsCommand = defineCommand({
  meta: {
    name: "fleet-bets",
    description:
      "Score leader bets: join queue ledger ids with dispatch state and job outcomes for per-bet status and per-lane merged rate.",
  },
  args: {
    json: {
      type: "boolean",
      description:
        "Emit schemaVersion 1 JSON; open covers unresolved work, mergedRate uses resolved bets.",
    },
    queue: { type: "string", description: "Fleet state directory (default: ~/.ashlr-runs/queue)." },
    router: {
      type: "string",
      description: "Leader queue ledger path (default: <queue>/router-queue.md).",
    },
    ready: { type: "string", description: "Dispatch queue TSV (default: <queue>/ready.tsv)." },
    metrics: {
      type: "string",
      description: "Job outcomes JSONL (default: <runs>/metrics/jobs.jsonl).",
    },
    src: { type: "string", description: "Source marker selecting bets (default: leader)." },
  },
  async run({ args }) {
    const report = await collectFleetBets(
      args.queue ?? join(homedir(), ".ashlr-runs", "queue"),
      args,
    );
    if (args.json) console.log(JSON.stringify(report));
    else {
      for (const bet of report.bets)
        console.log(
          `${bet.id}: ${bet.status}${bet.lane ? ` (${bet.lane})` : ""}${bet.url ? ` ${bet.url}` : ""}`,
        );
      for (const lane of report.lanes)
        console.log(
          `${lane.lane ?? "unknown"}: ${lane.merged}/${lane.resolved} resolved merged over ${lane.bets} bets`,
        );
      console.log(
        `total: ${report.totals.merged}/${report.totals.resolved} resolved merged over ${report.totals.bets} bets`,
      );
    }
  },
});
