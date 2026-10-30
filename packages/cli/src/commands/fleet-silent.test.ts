import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetSilent } from "./fleet-silent.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const ts = (minutes: number) => new Date(now - minutes * 60000).toISOString();
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");
async function fixture(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "fleet-silent-"));
  try {
    await mkdir(join(root, "metrics"));
    for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
    await run(root);
    for (const [file, text] of Object.entries(files))
      expect(await readFile(join(root, file), "utf8")).toBe(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const findings = async (root: string) => (await collectFleetSilent(root, now)).findings;

test("author fixture: latest non-ok run is named, recovery clears history and bodies stay private", () =>
  fixture(
    {
      "restock-author.log": `${ts(2)} ok\n${ts(1)} failed error=private-value\n`,
      "leader-author.log": jsonl([
        { status: "error", timestamp: ts(3) },
        { status: "ok", timestamp: ts(1) },
      ]),
    },
    async (root) => {
      expect(await findings(root)).toEqual([
        { rule: "author-non-ok", author: "restock-author.log" },
      ]);
      expect(JSON.stringify(await collectFleetSilent(root, now))).not.toContain("private-value");
    },
  ));

test("need/picked fixture: only latest unmet lane demand, across text and JSON author summaries", () =>
  fixture(
    {
      "restock-author.log": [
        `${ts(3)} ok lane=devin need=2 picked=0`,
        `${ts(1)} ok lane=devin need=2 picked=1`,
        JSON.stringify({ ts: ts(2), status: "ok", pool: "codex-cmp", need: 3, picked: 0 }),
        `${ts(1)} ok lane=idle need=0 picked=0`,
      ].join("\n"),
    },
    async (root) => {
      expect(await findings(root)).toEqual([
        { rule: "need-without-picks", lane: "codex-cmp", need: 3, picked: 0 },
      ]);
    },
  ));

test("finishes fixture: exactly the last ten finishes must all explicitly be empty", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({
    ts: ts(11 - i),
    event: "finish",
    lane: "devin",
    empty: i > 0,
  }));
  return fixture(
    {
      "metrics/jobs.jsonl": jsonl([
        ...rows.toReversed(), // timestamp order wins over file order
        ...rows.slice(0, 9).map((r) => ({ ...r, lane: "short", empty: true })),
        ...rows
          .slice(1)
          .map((r, i) => ({ ...r, lane: "unknown", empty: i === 9 ? undefined : true })),
        ...rows.map((r, i) => ({ ...r, lane: "recovered", empty: i !== 10 })),
        { ts: ts(-1), event: "finish", lane: "devin", empty: false },
      ]),
    },
    async (root) => {
      expect(await findings(root)).toEqual([{ rule: "ten-empty-finishes", lane: "devin" }]);
    },
  );
});

for (const age of [19.99, 20, 21])
  test(`launch fixture: fleet-wide 20-minute boundary (${age})`, () =>
    fixture(
      {
        "metrics/jobs.jsonl": jsonl([
          { ts: ts(60), event: "launch", lane: "old" },
          { ts: ts(age), event: "launch", lane: "active" },
          { ts: ts(-1), event: "launch", lane: "future" },
        ]),
      },
      async (root) => {
        expect(await findings(root)).toEqual(
          age < 20 ? [] : [{ rule: "no-launch-20m", lastLaunchAt: ts(age) }],
        );
      },
    ));

test("dispatch fixture: zero launches needs 20 minutes of history; a positive tick clears silence", () =>
  fixture(
    {
      "dispatchd.log": `${ts(20)} tick run={} q=2 launched=0\n${ts(1)} tick run={} q=2 launched=0\n`,
    },
    async (root) => {
      expect(await findings(root)).toEqual([{ rule: "no-launch-20m", lastLaunchAt: null }]);
      await fixture(
        {
          "dispatchd.log": `${ts(20)} tick run={} q=2 launched=0\n${ts(1)} tick run={} q=2 launched=1\n`,
        },
        async (fresh) => {
          expect(await findings(fresh)).toEqual([]);
        },
      );
    },
  ));

test("FIXUP fixture: launch reuse on distinct UTC days; same-day repeats and cross-midnight finishes excluded", () =>
  fixture(
    {
      "metrics/jobs.jsonl": jsonl([
        { ts: "2026-10-29T23:59:00Z", event: "launch", job: "RQ-FIXUP-1" },
        { ts: ts(1), event: "launch", job: "RQ-FIXUP-1" },
        { ts: ts(2), event: "launch", job: "RQ-FIXUP-1" },
        { ts: "2026-10-29T23:59:00Z", event: "launch", job: "FIXUP-2" },
        { ts: ts(1), event: "finish", job: "FIXUP-2" },
        { ts: ts(1), event: "launch", job: "RQ-ORDINARY" },
      ]),
    },
    async (root) => {
      expect(await findings(root)).toEqual([
        { rule: "fixup-id-reused", jobId: "RQ-FIXUP-1", days: ["2026-10-29", "2026-10-30"] },
      ]);
    },
  ));

test("missing, malformed, oversized, directory and symlink sources remain unknown without exposing bodies", () =>
  fixture({}, async (root) => {
    expect(await findings(root)).toEqual([]);
    expect((await collectFleetSilent(root, now)).sources).toMatchObject({
      authors: "missing",
      "metrics/jobs.jsonl": "missing",
    });
    await writeFile(join(root, "dispatch-events.log"), "{private-value");
    await mkdir(join(root, "dispatchd.log"));
    await symlink(join(root, "dispatch-events.log"), join(root, "restock-author.log"));
    await writeFile(join(root, "metrics/jobs.jsonl"), "");
    await truncate(join(root, "metrics/jobs.jsonl"), 16 * 1024 * 1024 + 1);
    const report = await collectFleetSilent(root, now);
    for (const path of [
      "dispatch-events.log",
      "dispatchd.log",
      "restock-author.log",
      "metrics/jobs.jsonl",
    ])
      expect(report.sources[path]).toBe("invalid");
    expect(report.findings).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("private-value");
  }));

test("malformed newer records and invalid timestamps suppress stale latest/last-ten/absence claims", async () => {
  for (const bad of ["{broken", '{"event":"launch","ts":0}', '{"status":5}', '{"ts":"bad"}']) {
    await fixture(
      {
        "restock-author.log": `${ts(1)} failed\n${bad}`,
        "dispatchd.log": `${ts(30)} tick run={} q=2 launched=0`,
        "metrics/jobs.jsonl": `${jsonl(Array.from({ length: 10 }, () => ({ event: "finish", lane: "devin", empty: true })))}\n${bad}`,
      },
      async (root) => {
        const report = await collectFleetSilent(root, now);
        expect(report.sources["restock-author.log"]).toBe("invalid");
        expect(report.sources["metrics/jobs.jsonl"]).toBe("invalid");
        expect(report.findings).toEqual([]);
      },
    );
  }
  await fixture(
    {
      "restock-author.log": jsonl([
        { ts: ts(2), status: "ok", lane: "devin", need: 2, picked: 0 },
        { ts: ts(1), status: "ok", lane: "devin", need: 0, picked: "bad" },
      ]),
    },
    async (root) => {
      expect((await collectFleetSilent(root, now)).sources["restock-author.log"]).toBe("invalid");
      expect(await findings(root)).toEqual([]);
    },
  );
});

test("legacy undated finishes use append order; unrecognized author logs are unknown", () =>
  fixture(
    {
      "restock-author.log": "",
      "metrics/jobs.jsonl": jsonl(
        Array.from({ length: 10 }, () => ({ event: "finish", lane: "devin", empty: true })),
      ),
    },
    async (root) => {
      const report = await collectFleetSilent(root, now);
      expect(report.findings).toEqual([{ rule: "ten-empty-finishes", lane: "devin" }]);
      expect(report.sources["restock-author.log"]).toBe("unrecognized");
    },
  ));

test(
  "CLI emits one JSON report by default and --json; help and all completions register it",
  () =>
    fixture({}, async (root) => {
      const cli = async (...args: string[]) => {
        const child = Bun.spawn([process.execPath, "packages/cli/src/index.ts", ...args], {
          env: {
            HOME: root,
            PATH: process.env.PATH ?? "",
            STACK_NO_UPDATE_CHECK: "1",
            STACK_TELEMETRY: "0",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(await child.exited).toBe(0);
        expect(stderr).toBe("");
        return stdout;
      };
      for (const flags of [[], ["--json"]]) {
        const report = JSON.parse(await cli("fleet-silent", "--runs", root, ...flags));
        expect(report.schemaVersion).toBe(1);
        expect(report.findings).toEqual([]);
      }
      const defaultRuns = join(root, ".ashlr-runs");
      await mkdir(defaultRuns);
      const authorLog = JSON.stringify({ status: "failed" });
      await writeFile(join(defaultRuns, "leader-author.log"), authorLog);
      const report = JSON.parse(await cli("fleet-silent"));
      expect(report.findings).toEqual([{ rule: "author-non-ok", author: "leader-author.log" }]);
      expect(await readFile(join(defaultRuns, "leader-author.log"), "utf8")).toBe(authorLog);
      expect(await cli("fleet-silent", "--help")).toContain("--runs");
      expect(await cli("--help")).toContain("fleet-silent");
      for (const shell of ["bash", "zsh", "fish"])
        expect(await cli("completion", shell)).toContain("fleet-silent");
    }),
  30000,
);
