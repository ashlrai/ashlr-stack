import { expect, test } from "bun:test";
import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FleetLines, fleetEvents, parseFleetEvent, serveFleet } from "../commands/fleet-stream.ts";

const dispatch = '{"event":"launched","job_id":"RQ-1","pool":"codex","prompt":"private"}';
const job = '{"status":"completed","id":"RQ-1","repo":"ashlr-stack","ts":"2026-10-30T12:00:00Z"}';

test("typed dispatch and job events project only public fields", () => {
  expect(parseFleetEvent(dispatch, "dispatch")).toEqual({
    schemaVersion: 1,
    type: "dispatch",
    event: "launched",
    jobId: "RQ-1",
    pool: "codex",
    timestamp: null,
    repo: null,
  });
  expect(parseFleetEvent(job, "job")?.type).toBe("job");
  expect(parseFleetEvent(job, "job")?.event).toBe("completed");
  expect(parseFleetEvent("2026-10-30 12:00:00 REAP job=RQ-1 pool=codex", "dispatch")?.jobId).toBe(
    "RQ-1",
  );
  for (const line of ["bad", "null", "[]", "{}", '{"event":3}'])
    expect(parseFleetEvent(line, "job")).toBeNull();
});

test("partial lines commit once; CRLF, malformed and oversized records recover", () => {
  const lines = new FleetLines();
  expect(lines.push(dispatch.slice(0, 20), "dispatch")).toEqual([]);
  expect(lines.push(dispatch.slice(20), "dispatch")).toEqual([]);
  expect(lines.push(`\r\nbad\n${dispatch}\n`, "dispatch")).toHaveLength(2);
  expect(lines.push("x".repeat(70000), "dispatch")).toEqual([]);
  expect(lines.push(`\n${dispatch}\n`, "dispatch")).toHaveLength(1);
});

test("files replay, append partial lines, rotate, truncate, and serve localhost SSE", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleet-stream-"));
  const paths = { dispatch: join(root, "dispatch-events.log"), job: join(root, "jobs.jsonl") };
  const abort = new AbortController();
  const stream = fleetEvents(paths, true, abort.signal);
  try {
    expect(await Array.fromAsync(fleetEvents(paths))).toEqual([]);
    await writeFile(paths.dispatch, `${dispatch}\n`);
    await writeFile(paths.job, job.slice(0, 10));
    expect((await stream.next()).value?.type).toBe("dispatch");
    await appendFile(paths.job, `${job.slice(10)}\n`);
    expect((await stream.next()).value?.type).toBe("job");
    await rename(paths.dispatch, `${paths.dispatch}.old`);
    await writeFile(paths.dispatch, `${dispatch}\n`);
    expect((await stream.next()).value?.event).toBe("launched");
    await writeFile(paths.job, '{"event":"done"}\n');
    expect((await stream.next()).value?.event).toBe("done");
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "packages/cli/src/index.ts",
        "fleet-stream",
        "--dispatch",
        paths.dispatch,
        "--jobs",
        paths.job,
      ],
      { env: { ...process.env, HOME: root, STACK_TELEMETRY: "0" }, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(
      output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).type),
    ).toEqual(["dispatch", "job"]);
    const server = serveFleet(paths, 0);
    try {
      expect(server.hostname).toBe("127.0.0.1");
      expect((await fetch(`http://127.0.0.1:${server.port}/missing`)).status).toBe(404);
      const response = await fetch(`http://127.0.0.1:${server.port}/events`);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      const frame = new TextDecoder().decode((await reader.read()).value);
      expect(frame).toContain("event: dispatch\ndata: ");
      expect(frame).not.toContain("private");
      await reader.cancel();
    } finally {
      await server.stop(true);
    }
  } finally {
    abort.abort();
    await stream.return();
    await rm(root, { recursive: true, force: true });
  }
});
