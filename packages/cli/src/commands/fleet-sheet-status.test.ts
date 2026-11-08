import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_RUN_SCHEMA } from "@ashlr/stack-core";
import { collectSheetReconcile, collectSheetStatusReport } from "./fleet-sheet-status.ts";

const home = await mkdtemp(join(tmpdir(), "fleet-sheet-status-"));
afterAll(() => rm(home, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-07T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const record = (executionId: string, finishedMs: number, status: "ok" | "error" = "ok") => ({
  schema: JOB_RUN_SCHEMA,
  job: "stacksync",
  executionId,
  direction: "postgres->sheets",
  startedAt: iso(finishedMs - 35),
  finishedAt: iso(finishedMs),
  durationMs: 35,
  status,
  rowsIn: 100,
  rowsOut: status === "ok" ? 95 : 34,
  stages: [
    { stage: "read_postgres", status: "ok", durationMs: 10, rowsIn: 0, rowsOut: 100 },
    { stage: "transform", status: "ok", durationMs: 5, rowsIn: 100, rowsOut: 95 },
    {
      stage: "write_sheet_jobs",
      status,
      durationMs: 20,
      rowsIn: 95,
      rowsOut: status === "ok" ? 95 : 34,
    },
  ],
  lastError:
    status === "error"
      ? { stage: "write_sheet_jobs", message: "Sheets API 429: quota exceeded" }
      : null,
  persistError: null,
});

async function writeTable(rows: unknown[], name = "job-runs.jsonl"): Promise<string> {
  const path = join(home, name);
  await writeFile(path, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  return path;
}

describe("collectSheetStatusReport", () => {
  test("aggregates per-sheet last success and staleness from the table", async () => {
    const path = await writeTable([
      record("ok1", T0 - 3_600_000),
      record("f1", T0 - 600_000, "error"),
    ]);
    const report = await collectSheetStatusReport(path, { now: T0 });
    expect(report.source).toBe("ok");
    expect(report.schemaVersion).toBe(1);
    expect(report.sheets).toHaveLength(1);
    expect(report.sheets[0]).toMatchObject({
      sheet: "stacksync",
      state: "failing",
      successAgeMs: 3_600_000,
      failuresSinceSuccess: 1,
    });
  });

  test("a missing table degrades to an empty report, not a crash", async () => {
    const report = await collectSheetStatusReport(join(home, "absent.jsonl"), { now: T0 });
    expect(report.source).toBe("missing");
    expect(report.sheets).toEqual([]);
  });

  test("malformed lines flag the source but keep the good rows", async () => {
    const path = join(home, "torn.jsonl");
    await writeFile(path, `${JSON.stringify(record("ok1", T0 - 60_000))}\nnot json\n`, "utf8");
    const report = await collectSheetStatusReport(path, { now: T0 });
    expect(report.source).toBe("invalid");
    expect(report.sheets[0]).toMatchObject({ sheet: "stacksync", state: "ok" });
  });

  test("--sheet narrows the report to one sheet", async () => {
    const path = await writeTable([
      record("ok1", T0 - 60_000),
      { ...record("ok2", T0 - 120_000), sheet: "metrics" },
    ]);
    const report = await collectSheetStatusReport(path, { now: T0, sheet: "metrics" });
    expect(report.sheets).toHaveLength(1);
    expect(report.sheets[0]?.sheet).toBe("metrics");
  });
});

describe("collectSheetReconcile", () => {
  test("recovered when a later execution wrote the sheet — the 5d2b848b question", async () => {
    const path = await writeTable([
      record("5d2b848b", T0 - 3_600_000, "error"),
      record("9a1c2d3e", T0 - 1_800_000),
    ]);
    const report = await collectSheetReconcile(path, "5d2b848b");
    expect(report).toMatchObject({
      verdict: "recovered",
      sheet: "stacksync",
      source: "ok",
      laterAttempts: 1,
    });
    expect(report.firstLaterSuccess?.executionId).toBe("9a1c2d3e");
  });

  test("still-stale when no later execution wrote the sheet", async () => {
    const path = await writeTable([record("5d2b848b", T0 - 3_600_000, "error")]);
    expect((await collectSheetReconcile(path, "5d2b848b")).verdict).toBe("still-stale");
  });

  test("unknown when the table cannot be read — a missing record is not evidence", async () => {
    const report = await collectSheetReconcile(join(home, "absent.jsonl"), "5d2b848b");
    expect(report).toMatchObject({ verdict: "unknown", source: "missing" });
  });

  test("unknown when every line is corrupt — flagged rows alone are not evidence", async () => {
    const path = join(home, "corrupt.jsonl");
    await writeFile(path, "not json\n{nope\n", "utf8");
    const report = await collectSheetReconcile(path, "5d2b848b");
    expect(report).toMatchObject({ verdict: "unknown", source: "invalid" });
  });

  test("a crash-torn tail still reconciles on the good rows it kept", async () => {
    const path = join(home, "torn-tail.jsonl");
    await writeFile(
      path,
      `${JSON.stringify(record("5d2b848b", T0 - 3_600_000, "error"))}\n${JSON.stringify(record("9a1c2d3e", T0 - 1_800_000)).slice(0, 40)}\n`,
      "utf8",
    );
    // The torn tail hides the later success: still-stale with a flagged source,
    // not a silent healthy verdict and not "unknown" either — rows were read.
    const report = await collectSheetReconcile(path, "5d2b848b");
    expect(report).toMatchObject({ verdict: "still-stale", source: "invalid" });
  });
});

describe("fleet-sheet-status CLI", () => {
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, "run", "packages/cli/src/index.ts", ...args], {
      env: { HOME: home, PATH: home, STACK_NO_UPDATE_CHECK: "1", STACK_TELEMETRY: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code: await child.exited, stdout, stderr };
  };

  test("--runs --json emits the sheet report; --execution reconciles one id", async () => {
    const path = await writeTable(
      [record("5d2b848b", T0 - 3_600_000, "error"), record("9a1c2d3e", T0 - 1_800_000)],
      "cli-table.jsonl",
    );
    const status = await cli("fleet-sheet-status", "--runs", path, "--json");
    expect(status.code).toBe(0);
    const report = JSON.parse(status.stdout);
    expect(report.sheets[0]).toMatchObject({ sheet: "stacksync", state: "ok" });

    const reconcile = await cli("fleet-sheet-status", "--runs", path, "--execution", "5d2b848b");
    expect(reconcile.code).toBe(0);
    expect(reconcile.stdout).toContain("recovered");
    expect(reconcile.stdout).toContain("9a1c2d3e");
  }, 30_000);

  test("nests under `stack fleet sheet-status` and registers help/completion", async () => {
    const path = await writeTable([record("ok1", T0 - 60_000)], "cli-nested.jsonl");
    const nested = await cli("fleet", "sheet-status", "--runs", path);
    expect(nested.code).toBe(0);
    expect(nested.stdout).toContain("stacksync: ok");
    expect(await cli("fleet-sheet-status", "--help")).toMatchObject({
      code: 0,
    });
    const help = await cli("--help");
    expect(help.stdout).toContain("fleet-sheet-status");
    for (const shell of ["bash", "zsh", "fish"])
      expect((await cli("completion", shell)).stdout).toContain("fleet-sheet-status");
  }, 60_000);
});
