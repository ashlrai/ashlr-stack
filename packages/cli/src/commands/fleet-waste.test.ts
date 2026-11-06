import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetWaste } from "./fleet-waste.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const event = (event: string, job: string, lane = "all-empty", extra = {}, time = now) =>
  JSON.stringify({ ts: new Date(time).toISOString(), event, job, lane, ...extra });

async function fixture(text: string, run: (path: string, home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "fleet-waste-"));
  const path = join(home, "jobs.jsonl");
  try {
    await writeFile(path, text);
    await run(path, home);
    expect(await readFile(path, "utf8")).toBe(text);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("counts an all-empty lane, skips by code and unfinished jobs despite malformed lines", async () => {
  await fixture(
    [
      event("launch", "A"),
      event("finish", "A", "all-empty", { empty: true }),
      event("launch", "B"),
      event("finish", "B", "all-empty", { empty: true }),
      event("precheck_skip", "C", "all-empty", { code: 3 }),
      event("precheck_skip", "D", "all-empty", { code: "3" }),
      event("precheck_skip", "E", "all-empty", { code: "already_done" }),
      event("precheck_skip", "F", "all-empty"),
      event("launch", "STILL-RUNNING", "work"),
      "broken private input",
      "null",
      "[]",
      event("launch", "bad", "work", { ts: "bad" }),
      event("launch", "bad", "work", { job: null }),
      event("launch", "bad", "work", { lane: {} }),
      event("launch", "bad", "work", { event: ["launch"], empty: true }),
      event("publish", "X"),
      "",
      event("launch", "OLD", "old", {}, now - 3600001),
      event("launch", "FUTURE", "future", {}, now + 1),
    ].join("\r\n"),
    async (path) => {
      const report = await collectFleetWaste(path, 1, now);
      expect(report).toEqual({
        schemaVersion: 1,
        windowStart: "2026-10-30T11:00:00.000Z",
        windowEnd: "2026-10-30T12:00:00.000Z",
        malformedLines: 7,
        lanes: [
          {
            lane: "all-empty",
            launches: 2,
            empties: 2,
            precheckSkip: { "3": 2, already_done: 1, unknown: 1 },
            neverFinished: 0,
            unfinishedJobs: [],
          },
          {
            lane: "work",
            launches: 1,
            empties: 0,
            precheckSkip: {},
            neverFinished: 1,
            unfinishedJobs: ["STILL-RUNNING"],
          },
        ],
      });
      expect(JSON.stringify(report)).not.toContain("private");
    },
  );
});

test("window boundaries, retries, lane identity and out-of-order finishes use timestamps", async () => {
  await fixture(
    [
      event("finish", "A", "done", { empty: false }, now - 1000),
      event("launch", "A", "done", {}, now - 1800000),
      event("launch", "A", "retry", {}, now),
      event("finish", "A", "retry", { empty: "true" }, now - 1000),
      event("launch", "A", "retry", {}, now - 10000),
      event("launch", "B", "done", { timestamp: new Date(now).toISOString(), ts: null }),
      event("finish", "B", "done"),
    ].join("\n"),
    async (path) => {
      const report = await collectFleetWaste(path, 0.5, now);
      expect(report.lanes).toEqual([
        {
          lane: "done",
          launches: 2,
          empties: 0,
          precheckSkip: {},
          neverFinished: 0,
          unfinishedJobs: [],
        },
        {
          lane: "retry",
          launches: 2,
          empties: 0,
          precheckSkip: {},
          neverFinished: 1,
          unfinishedJobs: ["A"],
        },
      ]);
    },
  );
});

test("empty input succeeds; invalid windows, missing files, directories and symlinks fail safely", async () => {
  await fixture("", async (path, home) => {
    expect((await collectFleetWaste(path, 1, now)).lanes).toEqual([]);
    expect((await collectFleetWaste(path, 1, now)).malformedLines).toBe(0);
    for (const hours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e100])
      await expect(collectFleetWaste(path, hours, now)).rejects.toThrow("positive finite");
    await symlink(path, join(home, "link"));
    for (const invalid of [join(home, "private-missing"), home, join(home, "link")])
      await expect(collectFleetWaste(invalid, 1, now)).rejects.toThrow(
        "Cannot read fleet waste metrics; expected a readable regular JSONL file.",
      );
  });
});

test("early EOF rejects partial metrics instead of reporting a false unfinished job", async () => {
  const launch = `${event("launch", "SHORT", "work")}\n`;
  await fixture(`${launch}${event("finish", "SHORT", "work")}\n`, async (path, home) => {
    // Isolate the FileHandle patch in a child so other tests keep real filesystem I/O.
    const script = `
      import { open } from "node:fs/promises";
      import { collectFleetWaste } from ${JSON.stringify(join(import.meta.dir, "fleet-waste.ts"))};
      const path = ${JSON.stringify(path)};
      const handle = await open(path, "r");
      const prototype = Object.getPrototypeOf(handle);
      const original = prototype.createReadStream;
      await handle.close();
      prototype.createReadStream = function(options) {
        return original.call(this, { ...options, end: ${Buffer.byteLength(launch) - 1} });
      };
      try {
        await collectFleetWaste(path, 1, ${now});
        process.exitCode = 2;
      } catch (error) {
        if (error.message !== "Cannot read fleet waste metrics; expected a readable regular JSONL file.")
          throw error;
      } finally {
        prototype.createReadStream = original;
      }
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 10000,
      env: { HOME: home, PATH: process.env.PATH },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

test("CLI exits 0 with one JSON document, validates hours, and registers help and completion", async () => {
  const text = event("launch", "CLI", "work", {}, Date.now() - 1000);
  await fixture(text, async (path, home) => {
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ["packages/cli/src/index.ts", ...args], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          HOME: home,
          PATH: process.env.PATH,
          STACK_NO_UPDATE_CHECK: "1",
          STACK_TELEMETRY: "0",
        },
      });
    for (const command of [["fleet-waste"], ["fleet", "waste"]]) {
      for (const flags of [[], ["--json", "--hours", "6"]]) {
        const result = cli(...command, "--metrics", path, ...flags);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout).lanes[0].neverFinished).toBe(1);
      }
      for (const hours of ["invalid", "0", "-1", "Infinity"])
        expect(cli(...command, "--metrics", path, "--hours", hours).status).toBe(1);
      const missing = cli(...command, "--json");
      expect(missing.status).toBe(1);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).not.toContain(home);
      const help = cli(...command, "--help").stdout;
      for (const flag of ["--metrics", "--hours", "--json"]) expect(help).toContain(flag);
      await mkdir(join(home, ".ashlr-runs", "metrics"), { recursive: true });
      const defaultPath = join(home, ".ashlr-runs", "metrics", "jobs.jsonl");
      await writeFile(defaultPath, text);
      const report = cli(...command, "--json");
      expect(report.status).toBe(0);
      expect(report.stderr).toBe("");
      expect(JSON.parse(report.stdout).lanes[0].unfinishedJobs).toEqual(["CLI"]);
      expect(await readFile(defaultPath, "utf8")).toBe(text);
      await rm(defaultPath);
    }
    await writeFile(path, "");
    const empty = cli("fleet-waste", "--metrics", path);
    expect(empty.status).toBe(0);
    expect(JSON.parse(empty.stdout).lanes).toEqual([]);
    expect(cli("--help").stdout).toContain("fleet-waste");
    expect(cli("fleet", "--help").stdout).toContain("waste");
    for (const shell of ["bash", "zsh", "fish"]) {
      const completion = cli("completion", shell).stdout;
      for (const word of ["fleet-waste", "waste", "metrics", "hours"])
        expect(completion).toContain(word);
    }
    await writeFile(path, text);
  });
}, 30000);
