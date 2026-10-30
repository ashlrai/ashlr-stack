import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetGraph } from "../commands/fleet-graph.ts";

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "fleet-graph-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("snapshot joins slots, router and latest journal state without private fields", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "slots.json"), '{"codex":{"target":0,"token":"private"}}');
    await writeFile(
      join(dir, "queue.jsonl"),
      '{"id":"RQ-1","pool":"codex","repo":"ashlrai/stack","status":"queued","prompt":"private"}\n',
    );
    await writeFile(
      join(dir, "jobs.jsonl"),
      '{"job_id":"RQ-1","status":"running"}\n{"job_id":"RQ-1","status":"done"}\n',
    );
    const graph = await collectFleetGraph(dir);
    expect(graph).toMatchInlineSnapshot(`
{
  "edges": [
    {
      "source": "job:RQ-1",
      "target": "pool:codex",
      "type": "runs-in",
    },
    {
      "source": "job:RQ-1",
      "target": "repo:ashlrai/stack",
      "type": "targets",
    },
  ],
  "nodes": [
    {
      "id": "job:RQ-1",
      "name": "RQ-1",
      "status": "done",
      "type": "job",
    },
    {
      "id": "pool:codex",
      "name": "codex",
      "target": 0,
      "type": "pool",
    },
    {
      "id": "repo:ashlrai/stack",
      "name": "ashlrai/stack",
      "type": "repo",
    },
  ],
  "schemaVersion": 1,
  "sources": {
    "jobs": "ok",
    "queue": "ok",
    "slots": "ok",
  },
}
`);
    expect(JSON.stringify(graph)).not.toContain("private");
  }));

test("missing files produce an explicit empty graph through the CLI", () =>
  fixture(async (dir) => {
    expect(await collectFleetGraph(dir)).toEqual({
      schemaVersion: 1,
      sources: { slots: "missing", queue: "missing", jobs: "missing" },
      nodes: [],
      edges: [],
    });
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "packages/cli/src/index.ts",
        "fleet-graph",
        "--json",
        "--queue",
        dir,
      ],
      { env: { HOME: dir, PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toEqual(await collectFleetGraph(dir));
  }));

test("malformed sources are isolated; custom router arrays are sorted and deduplicated", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "slots.json"), "[]");
    await writeFile(join(dir, "jobs.jsonl"), '{"id":"RQ-2"}\nbroken');
    const router = join(dir, "router.json");
    const rows = [
      { id: "RQ-2", pool: "other" },
      { id: "RQ-1", repo: "stack" },
      { id: "RQ-2", pool: "other" },
      { id: null },
    ];
    await writeFile(router, JSON.stringify(rows));
    const graph = await collectFleetGraph(dir, router);
    expect(graph.sources).toEqual({ slots: "invalid", jobs: "invalid", queue: "ok" });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "job:RQ-1",
      "job:RQ-2",
      "pool:other",
      "repo:stack",
    ]);
    expect(graph.edges).toHaveLength(2);
    await writeFile(router, JSON.stringify(rows.reverse()));
    expect(await collectFleetGraph(dir, router)).toEqual(graph);
  }));
