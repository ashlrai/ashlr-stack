import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { collectFleetLag } from "./fleet-lag.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const date = (time: number) => new Date(time).toISOString();
const sha = "a".repeat(40);
const head = "b".repeat(40);
const tag = { name: "release/v1", target: { oid: sha, committedDate: date(now - 86400000) } };
const metadata = (tags: unknown[] = [tag]) => ({
  data: {
    repository: {
      defaultBranchRef: { name: "release/main", target: { oid: head } },
      refs: { nodes: tags },
    },
  },
});
const pr = (number: number, seconds = number, merged = now - number * 1000) => ({
  number,
  created_at: date(merged - seconds * 1000),
  merged_at: date(merged),
  updated_at: date(now),
});
function client(tags: unknown[] = [tag], rows: unknown[] = []): GhRunner {
  return async (args) =>
    JSON.stringify(
      args[1] === "graphql"
        ? metadata(tags)
        : args[1]?.includes("/compare/")
          ? { ahead_by: 300 }
          : rows,
    );
}

test("reports every canonical repo, full ahead count, tag age and even median via a read-only client", async () => {
  const stub = client([tag], [pr(1, 10), pr(2, 30), { ...pr(3), merged_at: null }]);
  const report = await collectFleetLag(async (args, signal) => {
    expect(args[0]).toBe("api");
    expect(signal).toBeInstanceOf(AbortSignal);
    if (args[1] === "graphql") expect(args[3]).toContain("field:TAG_COMMIT_DATE,direction:DESC");
    if (args[1]?.includes("/compare/")) expect(args[1]).toEndWith(`${sha}...${head}?per_page=1`);
    return stub(args, signal);
  }, now);
  expect(report.repos.map((r) => r.repo)).toEqual(DOCTOR_REPOS);
  expect(report.repos[0]).toEqual({
    repo: DOCTOR_REPOS[0],
    status: "ok",
    defaultBranch: "release/main",
    latestTag: "release/v1",
    tagAgeDays: 1,
    commitsSinceTag: 300,
    mergedPrCount: 2,
    medianSeconds: 20,
  });
  expect(report.generatedAt).toBe(date(now));
});

test("annotated tag age uses tagger date; zero commits is a valid result", async () => {
  const annotated = {
    ...tag,
    target: {
      oid: "c".repeat(40),
      tagger: { date: date(now - 2 * 86400000) },
      target: { oid: sha },
    },
  };
  const report = await collectFleetLag(
    async (args, signal) =>
      args[1]?.includes("/compare/")
        ? '{"ahead_by":0}'
        : client([annotated], [pr(1, 0)])(args, signal),
    now,
  );
  expect(report.repos[0]).toMatchObject({
    status: "ok",
    tagAgeDays: 2,
    commitsSinceTag: 0,
    mergedPrCount: 1,
    medianSeconds: 0,
  });
});

test("no tags remains explicit and still reports PR latency without a comparison request", async () => {
  const report = await collectFleetLag(async (args, signal) => {
    expect(args[1]).not.toContain("/compare/");
    return client([], [pr(1, 7)])(args, signal);
  }, now);
  expect(
    report.repos.every(
      (r) =>
        r.status === "no-tags" &&
        r.latestTag === null &&
        r.commitsSinceTag === null &&
        r.tagAgeDays === null &&
        r.medianSeconds === 7,
    ),
  ).toBe(true);
  expect((await collectFleetLag(client([], []), now)).repos[0]).toMatchObject({
    status: "no-tags",
    mergedPrCount: 0,
    medianSeconds: null,
  });
});

test("last 20 means merge order across pages, ignoring closed PRs, duplicates and old merges updated recently", async () => {
  const pages = new Set<string>();
  const report = await collectFleetLag(async (args, signal) => {
    const path = args[1]!;
    if (!path.includes("/pulls?")) return client()(args, signal);
    pages.add(path.slice(path.lastIndexOf("page=")));
    const rows = path.endsWith("page=1")
      ? [
          ...Array.from({ length: 10 }, (_, i) => pr(i + 1)),
          ...Array.from({ length: 90 }, (_, i) => pr(100 + i, 10000, now - 86400000)),
        ]
      : [
          pr(1),
          ...Array.from({ length: 15 }, (_, i) => pr(i + 11)),
          { ...pr(999), merged_at: null },
        ];
    return JSON.stringify(rows);
  }, now);
  expect([...pages]).toEqual(["page=1", "page=2"]);
  expect(report.repos[0]).toMatchObject({ status: "ok", mergedPrCount: 20, medianSeconds: 10.5 });
});

test("stops paging once remaining update times cannot improve the latest 20 merges", async () => {
  const report = await collectFleetLag(async (args, signal) => {
    if (!args[1]?.includes("/pulls?")) return client()(args, signal);
    expect(args[1]).toEndWith("page=1");
    return JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        ...pr(i + 1),
        updated_at: date(now - (i + 1) * 1000),
      })),
    );
  }, now);
  expect(report.repos[0]).toMatchObject({ status: "ok", mergedPrCount: 20, medianSeconds: 10.5 });
});

test("unavailable or malformed sources never become zero or leak errors, and other repos continue", async () => {
  for (const bad of [
    "bad json",
    "{}",
    "null",
    JSON.stringify({ ...metadata(), errors: [{ message: "private error" }] }),
  ]) {
    const report = await collectFleetLag(async () => bad, now);
    expect(
      report.repos.every(
        (r) => r.status === "unavailable" && r.mergedPrCount === null && r.commitsSinceTag === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private error");
  }
  for (const rows of [
    [{ ...pr(1), created_at: null }],
    [pr(1, -1)],
    [{ ...pr(1), updated_at: "bad" }],
  ]) {
    expect((await collectFleetLag(client([], rows), now)).repos[0]?.status).toBe("unavailable");
  }
  const report = await collectFleetLag(async (args, signal) => {
    if (args[3]?.includes('name:"phantom"')) throw new Error("private stderr");
    if (args[1]?.includes("/lexicon/compare/")) return '{"ahead_by":-1}';
    return client()(args, signal);
  }, now);
  expect(report.repos[0]).toMatchObject({ status: "ok", commitsSinceTag: 300, mergedPrCount: 0 });
  expect(report.repos[1]).toMatchObject({ status: "unavailable", latestTag: null });
  expect(report.repos[4]).toMatchObject({ status: "unavailable", commitsSinceTag: null });
  expect(JSON.stringify(report)).not.toContain("private stderr");
});

test("CLI uses Locus, emits one JSON document, renders tagless rows and registers help/completion", async () => {
  const home = await mkdtemp(join(tmpdir(), "fleet-lag-"));
  try {
    await writeFile(
      join(home, "locus"),
      `#!/bin/sh\n[ "$1 $2 $3 $4" = "exec -- gh api" ] || exit 2\ncase "$5" in\ngraphql) printf '%s\\n' '${JSON.stringify(metadata([]))}' ;;\n*/pulls\\?*) echo '[]' ;;\n*) exit 3 ;;\nesac\n`,
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
    const report = JSON.parse(await cli("fleet-lag", "--json"));
    expect(report.schemaVersion).toBe(1);
    expect(report.repos).toHaveLength(DOCTOR_REPOS.length);
    expect(report.repos.every((r: { status: string }) => r.status === "no-tags")).toBe(true);
    expect(await cli("fleet-lag")).toContain("ashlrai/ashlr-stack: no-tags");
    expect(await cli("fleet-lag", "--help")).toContain("--json");
    expect(await cli("--help")).toContain("fleet-lag");
    for (const shell of ["bash", "zsh", "fish"])
      expect(await cli("completion", shell)).toContain("fleet-lag");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
