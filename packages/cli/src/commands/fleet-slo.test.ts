import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { collectFleetSlo } from "./fleet-slo.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const date = (time: number) => new Date(time).toISOString();
const WINDOW_MS = 6 * 60 * 60 * 1000;
const pr = (seconds: number, merged = now - seconds * 100) => ({
  created_at: date(merged - seconds * 1000),
  merged_at: date(merged),
  updated_at: date(merged),
});
const openPulls = (total: number, mergeable: string[] = []) => ({
  data: {
    repository: {
      pullRequests: {
        totalCount: total,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: mergeable.map((state) => ({ mergeable: state })),
      },
    },
  },
});

/** Closed-PR pages go to the latency collector; graphql goes to the open/conflict scan. */
function client(rows: unknown[] = [], pulls: unknown = openPulls(0)): GhRunner {
  return async (args) => JSON.stringify(args[1] === "graphql" ? pulls : rows);
}

test("reports every repo with window merges, percentiles, open and conflicting counts and SLO verdicts", async () => {
  const rows = [pr(120), pr(480), { ...pr(60), merged_at: null }];
  const pulls = openPulls(3, ["MERGEABLE", "CONFLICTING", "UNKNOWN"]);
  const report = await collectFleetSlo(async (args, signal) => {
    expect(args[0]).toBe("api");
    expect(signal).toBeInstanceOf(AbortSignal);
    return client(rows, pulls)(args, signal);
  }, now);
  expect(report.schemaVersion).toBe(1);
  expect(report.windowStart).toBe(date(now - WINDOW_MS));
  expect(report.windowEnd).toBe(date(now));
  expect(report.targets).toEqual({
    mergesPerWindow: { repo: "ashlrai/phantom", count: 20 },
    mergeWithinSeconds: 300,
  });
  expect(report.repos.map((r) => r.repo)).toEqual(DOCTOR_REPOS);
  expect(report.repos[0]).toEqual({
    repo: "ashlrai/ashlr-stack",
    status: "ok",
    mergedPrCount: 2,
    medianSeconds: 300,
    p90Seconds: 444,
    openPrCount: 3,
    conflictingPrCount: 1,
    meets: { mergesPerWindow: null, mergeWithin: true },
  });
  // Only ashlrai/phantom carries the merge-volume verdict.
  expect(report.repos[1]).toMatchObject({
    repo: "ashlrai/phantom",
    meets: { mergesPerWindow: false, mergeWithin: true },
  });
});

test("phantom merge volume and five-minute medians flip the verdicts each way", async () => {
  const fast = await collectFleetSlo(
    client(Array.from({ length: 20 }, (_, i) => pr(200, now - i * 1000))),
    now,
  );
  expect(fast.repos[1]).toMatchObject({
    repo: "ashlrai/phantom",
    mergedPrCount: 20,
    medianSeconds: 200,
    meets: { mergesPerWindow: true, mergeWithin: true },
  });
  expect(fast.repos[0]?.meets).toEqual({ mergesPerWindow: null, mergeWithin: true });
  const slow = await collectFleetSlo(client([pr(301)]), now);
  expect(slow.repos[1]?.meets).toEqual({ mergesPerWindow: false, mergeWithin: false });
  const quiet = await collectFleetSlo(client([], openPulls(0)), now);
  expect(quiet.repos[1]).toMatchObject({
    mergedPrCount: 0,
    meets: { mergesPerWindow: false, mergeWithin: null },
  });
});

test("open pull request pages follow cursors and count only CONFLICTING nodes", async () => {
  let pages = 0;
  const report = await collectFleetSlo(async (args) => {
    if (args[1] !== "graphql") return "[]";
    pages++;
    const query = args[3]!;
    if (!query.includes("after:"))
      return JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              totalCount: 150,
              pageInfo: { hasNextPage: true, endCursor: "cursor1" },
              nodes: [
                { mergeable: "CONFLICTING" },
                ...Array.from({ length: 99 }, () => ({ mergeable: "MERGEABLE" })),
              ],
            },
          },
        },
      });
    expect(query).toContain('after:"cursor1"');
    return JSON.stringify(openPulls(150, ["CONFLICTING", "UNKNOWN"]));
  }, now);
  expect(pages).toBe(DOCTOR_REPOS.length * 2);
  expect(report.repos[0]).toMatchObject({
    status: "ok",
    openPrCount: 150,
    conflictingPrCount: 2,
  });
});

test("partial and unavailable sources stay null and never leak errors, and other repos continue", async () => {
  for (const bad of [
    "bad json",
    "{}",
    "null",
    JSON.stringify({ errors: [{ message: "private error" }] }),
    JSON.stringify(openPulls(-1)),
    JSON.stringify(openPulls(1, ["DIRTY"])),
    JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            totalCount: 2,
            pageInfo: { hasNextPage: true, endCursor: '",malicious:true,query:"' },
            nodes: [],
          },
        },
      },
    }),
  ]) {
    const report = await collectFleetSlo(
      async (args) => (args[1]?.includes("/pulls?") ? "[]" : bad),
      now,
    );
    // Closed pulls succeed, so only the open/conflict side is unavailable.
    expect(
      report.repos.every(
        (r) =>
          r.status === "partial" &&
          r.mergedPrCount === 0 &&
          r.openPrCount === null &&
          r.conflictingPrCount === null &&
          r.meets.mergeWithin === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private error");
  }
  for (const rows of [
    [{ ...pr(1), created_at: null }],
    [pr(-1, now - 60000)],
    [{ ...pr(1), updated_at: "bad" }],
  ]) {
    const report = await collectFleetSlo(client(rows), now);
    expect(
      report.repos.every(
        (r) =>
          r.status === "partial" &&
          r.mergedPrCount === null &&
          r.openPrCount === 0 &&
          r.meets.mergeWithin === null,
      ),
    ).toBe(true);
  }
  const both = await collectFleetSlo(async () => {
    throw new Error("private stderr");
  }, now);
  expect(
    both.repos.every(
      (r) => r.status === "unavailable" && r.mergedPrCount === null && r.openPrCount === null,
    ),
  ).toBe(true);
  expect(JSON.stringify(both)).not.toContain("private stderr");
  const split = await collectFleetSlo(async (args, signal) => {
    if (args[1]?.includes("/phantom/pulls?") || args[3]?.includes('name:"phantom"'))
      throw new Error("private stderr");
    return client([pr(60)], openPulls(1, ["CONFLICTING"]))(args, signal);
  }, now);
  expect(split.repos[0]?.status).toBe("ok");
  expect(split.repos[1]).toMatchObject({
    repo: "ashlrai/phantom",
    status: "unavailable",
    meets: { mergesPerWindow: null, mergeWithin: null },
  });
});

test("CLI routes through Locus and `stack fleet slo --json` emits one JSON document", async () => {
  const home = await mkdtemp(join(tmpdir(), "fleet-slo-"));
  try {
    await writeFile(
      join(home, "locus"),
      `#!/bin/sh
[ "$1 $2 $3 $4" = "exec -- gh api" ] || exit 2
case "$5" in
graphql) printf '%s\\n' '${JSON.stringify(openPulls(2, ["CONFLICTING", "MERGEABLE"]))}' ;;
*/pulls\\?*) echo '[]' ;;
*) exit 3 ;;
esac
`,
      { mode: 0o755 },
    );
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
      expect(await child.exited).toBe(0);
      expect(stderr).toBe("");
      return stdout;
    };
    for (const argv of [
      ["fleet", "slo", "--json"],
      ["fleet-slo", "--json"],
    ]) {
      const report = JSON.parse(await cli(...argv));
      expect(report.schemaVersion).toBe(1);
      expect(report.targets.mergeWithinSeconds).toBe(300);
      expect(report.repos).toHaveLength(DOCTOR_REPOS.length);
      expect(
        report.repos.every(
          (r: { status: string; openPrCount: number; conflictingPrCount: number }) =>
            r.status === "ok" && r.openPrCount === 2 && r.conflictingPrCount === 1,
        ),
      ).toBe(true);
    }
    const [human, sloHelp, flatHelp, fleetHelp, rootHelp, fleetJson, bash, zsh, fish] =
      await Promise.all([
        cli("fleet", "slo"),
        cli("fleet", "slo", "--help"),
        cli("fleet-slo", "--help"),
        cli("fleet", "--help"),
        cli("--help"),
        cli("fleet", "--json"),
        cli("completion", "bash"),
        cli("completion", "zsh"),
        cli("completion", "fish"),
      ]);
    expect(human).toContain("ashlrai/phantom: ok");
    expect(sloHelp).toContain("--json");
    expect(flatHelp).toContain("fleet-slo");
    expect(fleetHelp).toContain("slo");
    expect(rootHelp).toContain("fleet-slo");
    // The parent report still runs when no subcommand is given.
    expect(fleetJson).toContain('"schemaVersion":1');
    for (const script of [bash, zsh, fish]) expect(script).toContain("fleet-slo");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 20000);
