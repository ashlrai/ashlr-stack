import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[\w./-]{1,200}$/.test(value);

async function source(
  path: string,
  slots = false,
): Promise<{ status: "ok" | "missing" | "unavailable" | "invalid"; rows: Row[] }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return {
      status: record(error) && error.code === "ENOENT" ? "missing" : "unavailable",
      rows: [],
    };
  }
  try {
    if (slots) {
      const data: unknown = JSON.parse(text);
      if (!record(data)) throw new Error();
      return {
        status: "ok",
        rows: Object.entries(data).map(([pool, value]) => ({
          pool,
          target: record(value) ? value.target : undefined,
        })),
      };
    }
    // Queue snapshots may be a JSON array; append-only journals use JSONL.
    const data: unknown = text.trim().startsWith("[")
      ? JSON.parse(text)
      : text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
    if (!Array.isArray(data) || !data.every(record)) throw new Error();
    return { status: "ok", rows: data };
  } catch {
    return { status: "invalid", rows: [] };
  }
}

/** Stable IDs and ordering; journal records override queue fields, last record wins.
 * Only public identifiers, status, and slot counts enter the graph.
 */
export async function collectFleetGraph(
  directory: string,
  router = join(directory, "queue.jsonl"),
) {
  const [slots, queue, jobs] = await Promise.all([
    source(join(directory, "slots.json"), true),
    source(router),
    source(join(directory, "jobs.jsonl")),
  ]);
  const nodes = new Map<string, Row>();
  const edges = new Map<string, { source: string; target: string; type: string }>();
  function node(type: string, name: string, fields: Row = {}) {
    const id = `${type}:${name}`;
    nodes.set(id, { ...nodes.get(id), id, type, name, ...fields });
    return id;
  }
  for (const row of slots.rows) {
    if (!identifier(row.pool)) continue;
    node("pool", row.pool, {
      target:
        typeof row.target === "number" && Number.isSafeInteger(row.target) && row.target >= 0
          ? row.target
          : null,
    });
  }
  const latest = new Map<string, Row>();
  for (const row of [...queue.rows, ...jobs.rows]) {
    const id = row.id ?? row.job_id;
    if (identifier(id)) latest.set(id, { ...latest.get(id), ...row });
  }
  for (const [id, row] of latest) {
    const job = node("job", id, { status: identifier(row.status) ? row.status : null });
    for (const [field, type] of [
      ["pool", "runs-in"],
      ["repo", "targets"],
    ] as const) {
      if (!identifier(row[field])) continue;
      const target = node(field === "pool" ? "pool" : "repo", row[field]);
      edges.set(`${job}:${type}:${target}`, { source: job, target, type });
    }
  }
  return {
    schemaVersion: 1,
    sources: { slots: slots.status, queue: queue.status, jobs: jobs.status },
    nodes: [...nodes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
    edges: [...edges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
  };
}

export const fleetGraphCommand = defineCommand({
  meta: {
    name: "fleet-graph",
    description: "Emit schema-versioned fleet pool, job, and repository nodes and edges.",
  },
  args: {
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON (also the default)." },
    queue: { type: "string", description: "Fleet state directory (default: ~/.ashlr-runs/queue)." },
    router: {
      type: "string",
      description: "Router JSON array or JSONL path (default: <queue>/queue.jsonl).",
    },
  },
  async run({ args }) {
    console.log(
      JSON.stringify(
        await collectFleetGraph(args.queue ?? join(homedir(), ".ashlr-runs", "queue"), args.router),
      ),
    );
  },
});
