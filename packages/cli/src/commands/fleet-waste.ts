import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { defineCommand } from "citty";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
interface Lane {
  lane: string;
  launches: number;
  empties: number;
  precheckSkip: Map<string, number>;
  jobs: Map<string, { launch: number; finish: number }>;
}

/** Inclusive trailing window; unfinished means no finish at/after the latest launch, as of now. */
export async function collectFleetWaste(metrics: string, hours = 1, now = Date.now()) {
  const start = now - hours * 3600000;
  if (
    !Number.isFinite(hours) ||
    hours <= 0 ||
    !Number.isFinite(new Date(start).getTime()) ||
    !Number.isFinite(new Date(now).getTime())
  )
    throw new Error("Hours must be a positive finite window.");
  const lanes = new Map<string, Lane>();
  let malformedLines = 0;
  try {
    const file = await open(
      metrics,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error();
      if (stat.size > 0) {
        // Read a fixed snapshot, never tail-truncate away completion evidence.
        const stream = file.createReadStream({ autoClose: false, end: stat.size - 1 });
        const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
        try {
          for await (const line of lines) {
            if (!line.trim()) continue;
            let row: Record<string, unknown>;
            try {
              row = JSON.parse(line);
              if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
              if (typeof row.event !== "string") throw new Error();
              if (!["launch", "finish", "precheck_skip"].includes(row.event)) continue;
              const ts = row.ts ?? row.timestamp;
              const time = typeof ts === "string" ? Date.parse(ts) : Number.NaN;
              if (!Number.isFinite(time) || typeof row.lane !== "string" || !ID.test(row.lane))
                throw new Error();
              if (typeof row.job !== "string" || !ID.test(row.job)) throw new Error();
              if (time < start || time > now) continue;
              const lane: Lane = lanes.get(row.lane) ?? {
                lane: row.lane,
                launches: 0,
                empties: 0,
                precheckSkip: new Map(),
                jobs: new Map(),
              };
              lanes.set(row.lane, lane);
              if (row.event === "precheck_skip") {
                const code =
                  typeof row.code === "number" && Number.isSafeInteger(row.code)
                    ? String(row.code)
                    : typeof row.code === "string" && ID.test(row.code)
                      ? row.code
                      : "unknown";
                lane.precheckSkip.set(code, (lane.precheckSkip.get(code) ?? 0) + 1);
              } else {
                const job = lane.jobs.get(row.job) ?? {
                  launch: Number.NEGATIVE_INFINITY,
                  finish: Number.NEGATIVE_INFINITY,
                };
                lane.jobs.set(row.job, job);
                if (row.event === "launch") {
                  lane.launches++;
                  job.launch = Math.max(job.launch, time);
                } else {
                  if (row.empty === true) lane.empties++;
                  job.finish = Math.max(job.finish, time);
                }
              }
            } catch {
              malformedLines++;
            }
          }
        } finally {
          lines.close();
          stream.destroy();
        }
      }
    } finally {
      await file.close();
    }
  } catch {
    // Never echo input rows, paths or OS error bodies, which may contain secrets.
    throw new Error("Cannot read fleet waste metrics; expected a readable regular JSONL file.");
  }
  return {
    schemaVersion: 1,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(now).toISOString(),
    malformedLines,
    lanes: [...lanes.values()]
      .sort((a, b) => a.lane.localeCompare(b.lane))
      .map((lane) => {
        const unfinishedJobs = [...lane.jobs]
          .filter(([, j]) => j.launch > j.finish)
          .map(([id]) => id)
          .sort();
        return {
          lane: lane.lane,
          launches: lane.launches,
          empties: lane.empties,
          precheckSkip: Object.fromEntries(
            [...lane.precheckSkip].sort(([a], [b]) => a.localeCompare(b)),
          ),
          neverFinished: unfinishedJobs.length,
          unfinishedJobs,
        };
      }),
  };
}

export const fleetWasteCommand = defineCommand({
  meta: {
    name: "fleet-waste",
    description:
      "Report per-lane launches, empty finishes, precheck skips by code and unfinished jobs.",
  },
  args: {
    metrics: {
      type: "string",
      description: "Job event JSONL (default: ~/.ashlr-runs/metrics/jobs.jsonl).",
    },
    hours: {
      type: "string",
      default: "1",
      description: "Positive trailing window in hours; fractional hours accepted.",
    },
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON (also the default)." },
  },
  async run({ args }) {
    console.log(
      JSON.stringify(
        await collectFleetWaste(
          args.metrics ?? join(homedir(), ".ashlr-runs", "metrics", "jobs.jsonl"),
          Number(args.hours),
        ),
      ),
    );
  },
});

export const fleetWasteSubcommand = defineCommand({
  ...fleetWasteCommand,
  meta: { ...fleetWasteCommand.meta, name: "waste" },
});
