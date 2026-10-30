import { type FileHandle, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defineCommand } from "citty";

export type FleetEvent = {
  schemaVersion: 1;
  type: "dispatch" | "job";
  event: string;
  timestamp: string | null;
  jobId: string | null;
  repo: string | null;
  pool: string | null;
};
type Source = FleetEvent["type"];
const field = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) if (typeof row[key] === "string") return row[key] as string;
  return null;
};

/** Project status fields only: raw payloads, prompts and errors never leave the log. */
export function parseFleetEvent(line: string, type: Source): FleetEvent | null {
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line);
  } catch {
    const match = line.match(/^(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\dZ?)\s+(\w+)\s+(.*)$/);
    if (!match || type !== "dispatch") return null;
    row = Object.fromEntries([...match[3]!.matchAll(/(\w+)=([^\s]+)/g)].map((m) => [m[1], m[2]]));
    row.event = match[2];
    row.timestamp = match[1];
  }
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const event = field(row, "event", "type", "status");
  if (!event) return null;
  return {
    schemaVersion: 1,
    type,
    event,
    timestamp: field(row, "timestamp", "ts"),
    jobId: field(row, "jobId", "job_id", "job", "id"),
    repo: field(row, "repo"),
    pool: field(row, "pool"),
  };
}

/** Newline is the commit boundary, even when the JSON itself already parses. */
export class FleetLines {
  private pending = "";
  private dropping = false;
  push(chunk: string, type: Source): FleetEvent[] {
    const lines = (this.pending + chunk).split("\n");
    this.pending = lines.pop()!;
    const events: FleetEvent[] = [];
    for (const line of lines) {
      const event = !this.dropping && line.length <= 65536 ? parseFleetEvent(line, type) : null;
      this.dropping = false;
      if (event) events.push(event);
    }
    if (this.pending.length > 65536) {
      this.pending = "";
      this.dropping = true;
    }
    return events;
  }
}

/** Bounded reads, independent partial-line buffers, and rotation/truncation recovery. */
export async function* fleetEvents(
  paths: Record<Source, string>,
  follow = false,
  signal?: AbortSignal,
) {
  const states = new Map<
    Source,
    { offset: number; inode: number; lines: FleetLines; decoder: TextDecoder }
  >();
  do {
    for (const type of ["dispatch", "job"] as const) {
      let file: FileHandle;
      try {
        file = await open(paths[type], "r");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new Error("Cannot read fleet stream source");
      }
      try {
        const stat = await file.stat();
        let state = states.get(type);
        if (!state || state.inode !== stat.ino || stat.size < state.offset) {
          state = {
            offset: 0,
            inode: stat.ino,
            lines: new FleetLines(),
            decoder: new TextDecoder(),
          };
          states.set(type, state);
        }
        const buffer = Buffer.alloc(65536);
        while (state.offset < stat.size && !signal?.aborted) {
          const { bytesRead } = await file.read(
            buffer,
            0,
            Math.min(buffer.length, stat.size - state.offset),
            state.offset,
          );
          if (!bytesRead) break;
          state.offset += bytesRead;
          yield* state.lines.push(
            state.decoder.decode(buffer.subarray(0, bytesRead), { stream: true }),
            type,
          );
        }
      } finally {
        await file.close();
      }
    }
    if (follow && !signal?.aborted) await delay(250, undefined, { signal }).catch(() => {});
  } while (follow && !signal?.aborted);
}

export function serveFleet(paths: Record<Source, string>, port: number) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/events")
        return new Response("Not found", { status: 404 });
      const abort = new AbortController();
      const iterator = fleetEvents(paths, true, abort.signal);
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else
              controller.enqueue(
                new TextEncoder().encode(
                  `event: ${next.value.type}\ndata: ${JSON.stringify(next.value)}\n\n`,
                ),
              );
          } catch {
            controller.error(new Error("Fleet stream unavailable"));
            abort.abort();
          }
        },
        async cancel() {
          abort.abort();
          await iterator.return();
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    },
  });
}

export const fleetStreamCommand = defineCommand({
  meta: {
    name: "fleet-stream",
    description: "Translate fleet logs to typed NDJSON or localhost SSE.",
  },
  args: {
    dispatch: { type: "string", description: "Path to dispatch-events.log." },
    jobs: { type: "string", description: "Path to metrics/jobs.jsonl." },
    follow: { type: "boolean", description: "Follow appended records (NDJSON)." },
    sse: { type: "boolean", description: "Serve a live stream at http://127.0.0.1:8788/events." },
    port: {
      type: "string",
      default: "8788",
      description: "Local SSE port (0 selects a free port).",
    },
  },
  async run({ args }) {
    const root = join(homedir(), ".ashlr-runs");
    const paths = {
      dispatch: args.dispatch ?? join(root, "dispatch-events.log"),
      job: args.jobs ?? join(root, "metrics", "jobs.jsonl"),
    };
    if (args.sse) {
      const port = Number(args.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid SSE port");
      const server = serveFleet(paths, port);
      console.error(`Fleet SSE: http://127.0.0.1:${server.port}/events`);
    } else
      for await (const event of fleetEvents(paths, args.follow)) console.log(JSON.stringify(event));
  },
});
