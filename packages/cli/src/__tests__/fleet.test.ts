import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleet, fleetLanes } from "../commands/fleet.ts";

const slots = '{"codex-personal":{"target":10},"devin":{"target":0}}';
const tick =
  '2026-10-29 12:30:00 tick run={"codex-personal":3,"devin":0} q=2 launched=0 reap=0 pause=False';

test("dispatcher fixtures: latest tick, zero counts, and extra log lines", () => {
  expect(fleetLanes(slots, `${tick.replace(":3", ":9")}\n${tick}\nREAP job`)).toEqual({
    lastTick: "2026-10-29 12:30:00",
    lanes: [
      { lane: "codex-personal", target: 10, running: 3 },
      { lane: "devin", target: 0, running: 0 },
    ],
  });
});

test("unavailable and malformed fields stay unknown, never zero", () => {
  expect(fleetLanes(slots, `${tick}\n2026-10-29 12:31:00 tick run=broken`)).toEqual({
    lastTick: "unknown",
    lanes: [
      { lane: "codex-personal", target: 10, running: "unknown" },
      { lane: "devin", target: 0, running: "unknown" },
    ],
  });
  expect(
    fleetLanes('{"bad":{"target":-1}}', '2026-10-29 12:30:00 tick run={"bad":null} q=0').lanes,
  ).toEqual([{ lane: "bad", target: "unknown", running: "unknown" }]);
  expect(fleetLanes("[]", "")).toEqual({ lastTick: "unknown", lanes: [] });
});

test("collection fixtures preserve repository metadata when CI is unavailable", async () => {
  const queue = await mkdtemp(join(tmpdir(), "stack-fleet-"));
  try {
    await writeFile(join(queue, "slots.json"), slots);
    await writeFile(join(queue, "dispatchd.log"), tick);
    const report = await collectFleet(queue, async (args) => {
      if (args[0] === "api")
        return JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: { name: "main" },
              pullRequests: { totalCount: 0 },
            },
          },
        });
      return '[{"status":"in_progress","conclusion":""}]';
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.repos[0]).toEqual({
      repo: "ashlrai/ashlr-stack",
      defaultBranch: "main",
      openPrCount: 0,
      ci: "pending",
    });
    expect(report.lanes[0]?.running).toBe(3);
    const offline = await collectFleet(join(queue, "missing"), async () => {
      throw new Error("private stderr");
    });
    expect(
      offline.repos.every((repo) => repo.ci === "unknown" && repo.openPrCount === "unknown"),
    ).toBe(true);
    expect(JSON.stringify(offline)).not.toContain("private stderr");
    expect(offline.lastTick).toBe("unknown");
  } finally {
    await rm(queue, { recursive: true, force: true });
  }
});

test("CLI routes GitHub through Locus and emits exactly one JSON document", async () => {
  const home = await mkdtemp(join(tmpdir(), "stack-fleet-cli-"));
  try {
    await writeFile(join(home, "slots.json"), slots);
    await writeFile(join(home, "dispatchd.log"), tick);
    await writeFile(
      join(home, "locus"),
      `#!/bin/sh
[ "$1 $2 $3" = "exec -- gh" ] || exit 2
if [ "$4" = api ]; then
  echo '{"data":{"repository":{"defaultBranchRef":{"name":"main"},"pullRequests":{"totalCount":2}}}}'
else
  echo '[{"status":"completed","conclusion":"success"}]'
fi
`,
      { mode: 0o755 },
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "packages/cli/src/index.ts",
        "fleet",
        "--json",
        "--queue",
        home,
        "--log",
        join(home, "dispatchd.log"),
      ],
      {
        env: { HOME: home, PATH: home },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const report = JSON.parse(output);
    expect(report.schemaVersion).toBe(1);
    expect(report.repos.every((repo: { ci: string }) => repo.ci === "success")).toBe(true);
    expect(report.lanes[0]).toEqual({ lane: "codex-personal", target: 10, running: 3 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
