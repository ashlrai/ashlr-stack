import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";

/** Public status files only; refuse links and bound each read to 16 MiB. */
async function source(path: string) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error();
      return { status: "ok", text: await file.readFile("utf8") };
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

/** Byte 160 is exclusive: a continuation byte at offset 160 means a split. */
export function splitQueueLines(text: string) {
  return text.split("\n").flatMap((line, index) => {
    const bytes = Buffer.from(line);
    if (bytes.length <= 160 || (bytes[160]! & 0xc0) !== 0x80) return [];
    let jobId: string | null = null;
    try {
      const row = JSON.parse(line);
      const id = row?.id ?? row?.job_id;
      if (typeof id === "string") jobId = id;
    } catch {}
    return [{ line: index + 1, jobId }];
  });
}

/** Last-hour launches and observed idle slot-minutes; naive dispatcher times are local. */
export async function collectFleetSupply(
  queue: string,
  log = join(dirname(queue), "dispatchd.log"),
  now = Date.now(),
) {
  const [dispatch, pending, restock, slots] = await Promise.all([
    source(log),
    source(join(queue, "queue.jsonl")),
    source(join(dirname(queue), "restock-author.log")),
    source(join(queue, "slots.json")),
  ]);
  const start = now - 3600000;
  const ticks = dispatch.text
    .split(/\r?\n/)
    .flatMap((line) => {
      const m = line.match(
        /^(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\dZ?) tick run=(\{.*?\}) q=\S+ launched=(\d+)/,
      );
      if (!m) return [];
      try {
        const time = Date.parse(m[1]!);
        const running = JSON.parse(m[2]!);
        if (
          !Number.isFinite(time) ||
          !running ||
          typeof running !== "object" ||
          Array.isArray(running)
        )
          return [];
        return [{ time, running: running as Record<string, unknown>, launches: Number(m[3]) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.time - b.time);
  let targets: Record<string, { target?: number }> = {};
  try {
    targets = JSON.parse(slots.text);
    if (!targets || typeof targets !== "object" || Array.isArray(targets)) throw new Error();
  } catch {
    slots.status = slots.status === "missing" ? "missing" : "invalid";
    targets = {};
  }
  const lanes = Object.entries(targets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, slot]) => {
      let idle = 0;
      let observed = 0;
      for (let i = 0; i + 1 < ticks.length; i++) {
        const tick = ticks[i]!;
        const minutes = (Math.min(now, ticks[i + 1]!.time) - Math.max(start, tick.time)) / 60000;
        const running = tick.running[lane];
        if (
          minutes <= 0 ||
          typeof running !== "number" ||
          !Number.isSafeInteger(running) ||
          running < 0 ||
          !Number.isSafeInteger(slot?.target) ||
          slot.target! < 0
        )
          continue;
        observed += minutes;
        idle += Math.max(0, slot.target! - running) * minutes;
      }
      return { lane, idleSlotMinutes: observed ? idle : null, observedMinutes: observed };
    });
  // Emit only an error category, never raw author output (which can contain credentials).
  const last = restock.text
    .split(/\r?\n/)
    .filter((line) => /\b(error|failed|exception|traceback)\b/i.test(line))
    .at(-1);
  return {
    schemaVersion: 1,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(now).toISOString(),
    sources: {
      dispatch: dispatch.status,
      queue: pending.status,
      slots: slots.status,
      restock: restock.status,
    },
    launchesPerHour: ticks.some((t) => t.time >= start && t.time <= now)
      ? ticks
          .filter((t) => t.time >= start && t.time <= now)
          .reduce((sum, t) => sum + t.launches, 0)
      : null,
    lanes,
    restockAuthorLastError: last
      ? {
          timestamp: last.match(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\dZ?/)?.[0] ?? null,
          category: /timeout|timed out/i.test(last)
            ? "timeout"
            : /rate.limit|429/i.test(last)
              ? "rate-limit"
              : "author-error",
        }
      : null,
    splitQueueLines: splitQueueLines(pending.text),
  };
}

export const fleetSupplyCommand = defineCommand({
  meta: {
    name: "fleet-supply",
    description:
      "Report hourly launches, observed lane idle minutes, restock errors and UTF-8 queue splits.",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit schemaVersion 1 JSON; unavailable metrics are null.",
    },
    queue: { type: "string", description: "Queue directory (default: ~/.ashlr-runs/queue)." },
    log: {
      type: "string",
      description: "Dispatcher log (default: dispatchd.log beside queue directory).",
    },
  },
  async run({ args }) {
    const report = await collectFleetSupply(
      args.queue ?? join(homedir(), ".ashlr-runs", "queue"),
      args.log,
    );
    if (args.json) console.log(JSON.stringify(report));
    else {
      console.log(`Launches/hour: ${report.launchesPerHour ?? "unknown"}`);
      for (const lane of report.lanes)
        console.log(
          `${lane.lane}: idle slot minutes=${lane.idleSlotMinutes ?? "unknown"} (${lane.observedMinutes} minutes observed)`,
        );
      console.log(
        `Restock author last error: ${report.restockAuthorLastError ? JSON.stringify(report.restockAuthorLastError) : report.sources.restock === "ok" ? "none" : "unknown"}`,
      );
      for (const row of report.splitQueueLines)
        console.log(`UTF-8 split: job=${row.jobId ?? "unknown"} line=${row.line}`);
    }
  },
});
