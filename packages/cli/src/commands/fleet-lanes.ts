import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import { type FleetRow, isFleetRow, readFleetJson, readFleetJsonl } from "../lib/fleet-jsonl.ts";

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** HOLD contents are never read; only public lane status fields are emitted. */
export async function collectFleetLanes(directory: string) {
  const [slots, queue, jobs, hold] = await Promise.all([
    readFleetJson(join(directory, "slots.json"), { object: true }),
    readFleetJsonl(join(directory, "queue.jsonl"), { allowArray: true }),
    readFleetJsonl(join(directory, "jobs.jsonl"), { allowArray: true }),
    lstat(join(directory, "HOLD")).then(
      () => true,
      (error: unknown) => (isFleetRow(error) && error.code === "ENOENT" ? false : null),
    ),
  ]);
  const latest = new Map<string, FleetRow>();
  for (const row of [...queue.rows, ...jobs.rows]) {
    const id = row.id ?? row.job_id;
    if (typeof id === "string") latest.set(id, { ...latest.get(id), ...row });
  }
  const known = queue.status === "ok" && jobs.status === "ok";
  const lanes = Object.entries(isFleetRow(slots.data) ? slots.data : {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, value]) => {
      const slot = isFleetRow(value) ? value : {};
      const target = count(slot.target);
      const ceiling = slot.ceiling === undefined ? target : count(slot.ceiling);
      const running = known
        ? [...latest.values()].filter((r) => r.pool === lane && r.status === "running").length
        : null;
      const queued = known
        ? [...latest.values()].filter((r) => r.pool === lane && r.status === "queued").length
        : null;
      const idleReason =
        hold === true
          ? "HOLD file"
          : slot.held === true
            ? "held flag"
            : hold === null ||
                target === null ||
                ceiling === null ||
                running === null ||
                queued === null
              ? "unknown"
              : running >= Math.min(target, ceiling)
                ? "ceiling"
                : queued === 0
                  ? "no queued work"
                  : null;
      return { lane, target, running, queued, idleReason };
    });
  return {
    schemaVersion: 1,
    sources: { slots: slots.status, queue: queue.status, jobs: jobs.status },
    lanes,
  };
}

export const fleetLanesCommand = defineCommand({
  meta: {
    name: "fleet-lanes",
    description: "Report lane targets, running and queued work, and dispatch idle reasons.",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit schemaVersion 1 JSON; null idleReason means ready to dispatch.",
    },
    queue: { type: "string", description: "Fleet state directory (default: ~/.ashlr-runs/queue)." },
  },
  async run({ args }) {
    const report = await collectFleetLanes(args.queue ?? join(homedir(), ".ashlr-runs", "queue"));
    if (args.json) console.log(JSON.stringify(report));
    else {
      console.log(
        `Sources: slots=${report.sources.slots}, queue=${report.sources.queue}, jobs=${report.sources.jobs}`,
      );
      for (const r of report.lanes)
        console.log(
          `${r.lane}: target=${r.target ?? "unknown"} running=${r.running ?? "unknown"} queued=${r.queued ?? "unknown"}; ${r.idleReason ?? "ready to dispatch"}`,
        );
    }
  },
});
