import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";

type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** Fixed public state files only; never follow links into credential files. */
async function source(path: string, slots = false) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      if (!(await file.stat()).isFile()) throw new Error();
      text = await file.readFile("utf8");
    } finally {
      await file.close();
    }
    const data: unknown =
      slots || text.trim().startsWith("[")
        ? JSON.parse(text)
        : text
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line));
    if (slots ? !record(data) : !Array.isArray(data) || !data.every(record)) throw new Error();
    return { status: "ok", data };
  } catch (error) {
    return { status: record(error) && error.code === "ENOENT" ? "missing" : "invalid", data: null };
  }
}

/** HOLD contents are never read; only public lane status fields are emitted. */
export async function collectFleetLanes(directory: string) {
  const [slots, queue, jobs, hold] = await Promise.all([
    source(join(directory, "slots.json"), true),
    source(join(directory, "queue.jsonl")),
    source(join(directory, "jobs.jsonl")),
    lstat(join(directory, "HOLD")).then(
      () => true,
      (error: unknown) => (record(error) && error.code === "ENOENT" ? false : null),
    ),
  ]);
  const latest = new Map<string, Row>();
  for (const row of [...((queue.data as Row[]) ?? []), ...((jobs.data as Row[]) ?? [])]) {
    const id = row.id ?? row.job_id;
    if (typeof id === "string") latest.set(id, { ...latest.get(id), ...row });
  }
  const known = queue.status === "ok" && jobs.status === "ok";
  const lanes = Object.entries((slots.data as Row) ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, value]) => {
      const slot = record(value) ? value : {};
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
