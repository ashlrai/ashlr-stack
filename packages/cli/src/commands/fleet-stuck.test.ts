import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { collectFleetStuck } from "./fleet-stuck.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const pr = (number = 1) => ({
  number,
  createdAt: "2026-10-28T12:00:00Z",
  mergeable: "CONFLICTING",
  mergeStateStatus: "DIRTY",
  changedFiles: 0,
  autoMergeRequest: null,
});
const page = (nodes: unknown[] = [], totalCount = nodes.length, hasNextPage = false) => ({
  data: {
    repository: {
      pullRequests: { nodes, totalCount, pageInfo: { hasNextPage, endCursor: "cursor" } },
    },
  },
});
function client(pages: unknown[] = [page()], files: unknown[][] = [[]]): GhRunner {
  return async (args, signal) => {
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(args[0]).toBe("api");
    expect(args).toContain("--paginate");
    expect(args).toContain("--slurp");
    if (args[1] === "graphql") {
      expect(args.at(-1)).toStartWith("query=query(");
      expect(args.at(-1)).toContain("states:OPEN");
    } else expect(args[1]).toMatch(/^repos\/ashlrai\/[^/]+\/pulls\/\d+\/files\?per_page=100$/);
    return JSON.stringify(args[1] === "graphql" ? pages : files);
  };
}

test("dirty PR preserves merge state and age; canonical repos have deterministic JSON", async () => {
  const report = await collectFleetStuck(client([page([pr()])]), now);
  expect(report.repos.map((r) => r.repo)).toEqual(DOCTOR_REPOS);
  expect(report.schemaVersion).toBe(1);
  expect(report.generatedAt).toBe(new Date(now).toISOString());
  expect(report.repos[0]).toEqual({
    repo: DOCTOR_REPOS[0],
    status: "ok",
    prs: [
      {
        number: 1,
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
        ageDays: 2,
        autoMergeEnabled: false,
        pathReasons: [],
      },
    ],
  });
});

test("auto-merge off reports server/ and lockfile hints including renamed paths across file pages", async () => {
  const report = await collectFleetStuck(
    client(
      [page([{ ...pr(), changedFiles: 4 }])],
      [
        [{ filename: "docs/serverish.md", previous_filename: "server/old.ts" }],
        [
          { filename: "nested/pnpm-lock.yaml" },
          { filename: "packages/api/server/main.ts" },
          { filename: "bun.lockb" },
        ],
      ],
    ),
    now,
  );
  expect(report.repos[0]?.prs?.[0]?.pathReasons).toEqual(["lockfile", "server/"]);
});

test("enabled auto-merge with nullable enabledAt skips file reads; unknown mergeability remains unknown", async () => {
  const stub = client([
    page([
      {
        ...pr(),
        mergeable: "UNKNOWN",
        mergeStateStatus: "UNKNOWN",
        autoMergeRequest: { enabledAt: null },
      },
    ]),
  ]);
  const report = await collectFleetStuck(async (args, signal) => {
    expect(args[1]).toBe("graphql");
    return stub(args, signal);
  }, now);
  expect(report.repos[0]?.prs?.[0]).toMatchObject({
    mergeable: "UNKNOWN",
    autoMergeEnabled: true,
    pathReasons: [],
  });
});

test("empty repos are successful empty lists", async () => {
  expect(
    (await collectFleetStuck(client(), now)).repos.every(
      (r) => r.status === "ok" && r.prs?.length === 0,
    ),
  ).toBe(true);
});

test("all PR pages are included and ordered by state then oldest first", async () => {
  const nodes = [{ ...pr(2), createdAt: new Date(now).toISOString() }, pr(1)];
  const report = await collectFleetStuck(
    client([
      page(nodes, 3, true),
      page([{ ...pr(3), mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }], 3),
    ]),
    now,
  );
  expect(report.repos[0]?.prs?.map((p) => p.number)).toEqual([3, 1, 2]);
});

test("malformed, partial and failed reads are unavailable, never empty or raw errors", async () => {
  for (const pages of [
    [],
    [null],
    [{ errors: [{ message: "private error" }] }],
    [page([pr()], 2)],
    [page([pr()], 1, true)],
    [page([pr(), pr()])],
    [page([{ ...pr(), createdAt: "invalid" }])],
    [page([{ ...pr(), createdAt: "2027-01-01" }])],
    [page([{ ...pr(), autoMergeRequest: undefined }])],
    [page([{ ...pr(), mergeStateStatus: "bogus" }])],
  ]) {
    const report = await collectFleetStuck(client(pages), now);
    expect(report.repos.every((r) => r.status === "unavailable" && r.prs === null)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private error");
  }
  for (const [files, changedFiles] of [
    [[], 0],
    [[[{ filename: null }]], 1],
    [[[{ filename: "README.md" }]], 2],
  ] as const) {
    const runner = client(
      [page([{ ...pr(), changedFiles }])],
      [...files].map((p) => [...p]),
    );
    expect((await collectFleetStuck(runner, now)).repos[0]?.status).toBe("unavailable");
  }
  const report = await collectFleetStuck(async (args, signal) => {
    if (args.join(" ").includes('name:"phantom"')) throw new Error("private stderr");
    return client()(args, signal);
  }, now);
  expect(report.repos[0]?.status).toBe("ok");
  expect(report.repos[1]).toMatchObject({ status: "unavailable", prs: null });
  expect(JSON.stringify(report)).not.toContain("private stderr");
  expect((await collectFleetStuck(async () => "invalid JSON", now)).repos[0]?.status).toBe(
    "unavailable",
  );
});

function cli(...args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "fleet-stuck-"));
  try {
    writeFileSync(
      join(home, "locus"),
      `#!/bin/sh\n[ "$1 $2 $3 $4 $5" = "exec -- gh api graphql" ] || exit 2\nprintf '%s\\n' '${JSON.stringify([page()])}'\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, ["run", "packages/cli/src/index.ts", ...args], {
      encoding: "utf8",
      timeout: 10000,
      env: { HOME: home, PATH: home, STACK_NO_UPDATE_CHECK: "1", STACK_TELEMETRY: "0" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    return result.stdout;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

for (const args of [["fleet-stuck"], ["fleet-stuck", "--json"]]) {
  test(`CLI ${args.join(" ")} routes through Locus and emits JSON`, () => {
    const report = JSON.parse(cli(...args));
    expect(report.repos).toHaveLength(DOCTOR_REPOS.length);
    expect(report.repos.every((r: { status: string }) => r.status === "ok")).toBe(true);
  });
}
for (const args of [
  ["fleet-stuck", "--help"],
  ["--help"],
  ...["bash", "zsh", "fish"].map((shell) => ["completion", shell]),
]) {
  test(`CLI ${args.join(" ")} registers fleet-stuck`, () => {
    const output = cli(...args);
    expect(output).toContain("fleet-stuck");
    if (args[0] === "fleet-stuck") expect(output).toContain("--json");
  });
}
