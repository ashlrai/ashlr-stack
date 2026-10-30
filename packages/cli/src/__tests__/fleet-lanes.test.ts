import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetLanes } from "../commands/fleet-lanes.ts";

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "fleet-lanes-"));
  try {
    await writeFile(join(dir, "queue.jsonl"), '[{"id":"one","pool":"ready","status":"queued"}]');
    await writeFile(join(dir, "jobs.jsonl"), "");
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("each dispatch blocker, precedence, ready lanes and latest job state", () =>
  fixture(async (dir) => {
    await writeFile(
      join(dir, "slots.json"),
      JSON.stringify({
        ready: { target: 2 },
        empty: { target: 1 },
        held: { target: 0, held: true },
        zero: { target: 0 },
        capped: { target: 3, ceiling: 1 },
      }),
    );
    await writeFile(
      join(dir, "jobs.jsonl"),
      [
        { id: "two", pool: "capped", status: "running" },
        { id: "old", pool: "empty", status: "running" },
        { id: "old", status: "done" },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    const report = await collectFleetLanes(dir);
    expect(report.lanes).toEqual([
      { lane: "capped", target: 3, running: 1, queued: 0, idleReason: "ceiling" },
      { lane: "empty", target: 1, running: 0, queued: 0, idleReason: "no queued work" },
      { lane: "held", target: 0, running: 0, queued: 0, idleReason: "held flag" },
      { lane: "ready", target: 2, running: 0, queued: 1, idleReason: null },
      { lane: "zero", target: 0, running: 0, queued: 0, idleReason: "ceiling" },
    ]);
    await writeFile(join(dir, "HOLD"), "private contents");
    expect((await collectFleetLanes(dir)).lanes.every((r) => r.idleReason === "HOLD file")).toBe(
      true,
    );
  }));

test("missing, malformed and linked state stays unknown without credential reads", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "slots.json"), '{"lane":{"target":2}}');
    await rm(join(dir, "jobs.jsonl"));
    expect((await collectFleetLanes(dir)).lanes[0]).toMatchObject({
      running: null,
      queued: null,
      idleReason: "unknown",
    });
    await writeFile(join(dir, "jobs.jsonl"), "broken");
    expect((await collectFleetLanes(dir)).sources.jobs).toBe("invalid");
    await rm(join(dir, "slots.json"));
    await writeFile(join(dir, "token-file"), '{"credential":{"target":99}}');
    await symlink(join(dir, "token-file"), join(dir, "slots.json"));
    expect((await collectFleetLanes(dir)).sources.slots).toBe("invalid");
    expect((await collectFleetLanes(dir)).lanes).toEqual([]);
  }));

test("CLI text and JSON expose only lane status", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "slots.json"), '{"ready":{"target":2,"token":"private"}}');
    for (const json of [false, true]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "run",
          "packages/cli/src/index.ts",
          "fleet-lanes",
          "--queue",
          dir,
          ...(json ? ["--json"] : []),
        ],
        {
          env: {
            HOME: dir,
            PATH: process.env.PATH ?? "",
            STACK_NO_UPDATE_CHECK: "1",
            STACK_TELEMETRY: "0",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(output).not.toContain("private");
      if (json) expect(JSON.parse(output)).toEqual(await collectFleetLanes(dir));
      else expect(output).toContain("ready: target=2 running=0 queued=1; ready to dispatch");
    }
  }));
