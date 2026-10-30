import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetSupply, splitQueueLines } from "./fleet-supply.ts";

test("flags an em-dash spanning byte 160 with its job id, including malformed lines", () => {
  const prefix = '{"id":"RQ-EMDASH","prompt":"';
  const line = `${prefix}${"a".repeat(159 - Buffer.byteLength(prefix))}—"}`;
  expect(Buffer.from(line)[159]).toBe(0xe2);
  expect(splitQueueLines(`${line}\n${"a".repeat(158)}—\n${"a".repeat(157)}—`)).toEqual([
    { line: 1, jobId: "RQ-EMDASH" },
    { line: 2, jobId: null },
  ]);
  expect(splitQueueLines(`${"a".repeat(160)}—`)).toEqual([]);
});

test("read-only last-hour report clips observed intervals and never echoes author errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleet-supply-"));
  const queue = join(root, "queue");
  const now = Date.parse("2026-10-30T12:00:00Z");
  try {
    await mkdir(queue);
    await writeFile(join(queue, "slots.json"), '{"codex":{"target":3},"unknown":{"target":2}}');
    await writeFile(join(queue, "queue.jsonl"), '{"id":"safe"}\n');
    const log = [
      ["10:50", 1, 9],
      ["11:10", 2, 2],
      ["11:40", 4, 1],
      ["12:10", 0, 99],
    ]
      .map(
        ([time, running, launches]) =>
          `2026-10-30T${time}:00Z tick run={"codex":${running}} q=2 launched=${launches}`,
      )
      .join("\n");
    await writeFile(join(root, "dispatchd.log"), log);
    await writeFile(
      join(root, "restock-author.log"),
      "2026-10-30T11:20:00Z ERROR timeout private-value\n2026-10-30T11:30:00Z ERROR 429 private-value\nsuccess\n",
    );
    const report = await collectFleetSupply(queue, undefined, now);
    expect(report.launchesPerHour).toBe(3);
    expect(report.lanes).toEqual([
      { lane: "codex", idleSlotMinutes: 50, observedMinutes: 60 },
      { lane: "unknown", idleSlotMinutes: null, observedMinutes: 0 },
    ]);
    expect(report.restockAuthorLastError).toEqual({
      timestamp: "2026-10-30T11:30:00Z",
      category: "rate-limit",
    });
    expect(JSON.stringify(report)).not.toContain("private-value");
    expect(await readFile(join(root, "dispatchd.log"), "utf8")).toBe(log);
    await rm(join(queue, "slots.json"));
    await symlink(join(root, "restock-author.log"), join(queue, "slots.json"));
    expect((await collectFleetSupply(queue, undefined, now)).sources.slots).toBe("invalid");
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "packages/cli/src/index.ts",
        "fleet-supply",
        "--queue",
        queue,
        "--json",
      ],
      {
        env: {
          HOME: root,
          PATH: process.env.PATH ?? "",
          STACK_NO_UPDATE_CHECK: "1",
          STACK_TELEMETRY: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(JSON.parse(await new Response(child.stdout).text()).schemaVersion).toBe(1);
    expect(await child.exited).toBe(0);
    await rm(join(root, "dispatchd.log"));
    const missing = await collectFleetSupply(queue, undefined, now);
    expect(missing.launchesPerHour).toBeNull();
    expect(missing.sources.dispatch).toBe("missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
