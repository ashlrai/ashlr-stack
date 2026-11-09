import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCTOR_REPOS, type GhRunner } from "../lib/doctor-repos.ts";
import { collectFleetReds, firstFailingTest } from "./fleet-reds.ts";

const fixtures = [
  [
    "vitest",
    " ❯ test/a.test.ts (2 tests | 1 failed)\n FAIL  test/a.test.ts > auth > rejects expiry\nAssertionError: private body",
    "test/a.test.ts > auth > rejects expiry",
  ],
  ["vitest verbose", " × rejects expiry 12ms\n × later failure 1ms", "rejects expiry"],
  [
    "node:test TAP",
    "TAP version 13\n    not ok 1 - rejects expiry\nnot ok 2 - parent suite",
    "rejects expiry",
  ],
  ["node:test spec", "✔ accepts token (1.2ms)\n✖ rejects expiry (2.1ms)", "rejects expiry"],
  [
    "nextest",
    "     PASS [ 0.002s] auth tests::accepts\n     FAIL [ 0.003s] auth tests::rejects_expiry\n FAIL [ 0.001s] auth tests::later",
    "auth tests::rejects_expiry",
  ],
];
for (const [format, log, expected] of fixtures) {
  test(`parses first ${format} failure with raw and gh-prefixed colored logs`, () => {
    expect(firstFailingTest(log!)).toBe(expected!);
    expect(
      firstFailingTest(
        log!
          .split("\n")
          .map((line) => `Test job\tRun tests\t2026-10-30T12:00:00.1234567Z \x1b[31m${line}\x1b[0m`)
          .join("\r\n"),
      ),
    ).toBe(expected!);
  });
}
test("empty output has no failing test", () => {
  expect(firstFailingTest("")).toBeNull();
});
test("a TAP not ok line marked SKIP is not a failure", () => {
  expect(firstFailingTest("not ok 1 - unavailable feature # SKIP")).toBeNull();
});
test("non-test failures and passing summaries remain unknown", () => {
  for (const log of [
    "FAIL test/a.test.ts\nError: cannot import",
    "Tests 1 failed | 2 passed",
    "error: linker failed",
    "ok 1 - passing",
  ])
    expect(firstFailingTest(log)).toBeNull();
});
test("node:test expected TODO failures do not hide the first real failing test", () => {
  expect(
    firstFailingTest("✖ expected todo failure (1.205125ms) # TODO\n✖ real failure (330.601834ms)"),
  ).toBe("real failure");
  expect(
    firstFailingTest(
      "not ok 1 - expected # TODO\nnot ok 2 - skipped # SKIP\nnot ok 3 - real failure",
    ),
  ).toBe("real failure");
});
test("TAP TODO failure followed by a real failure reports the real failure", () => {
  const tap = [
    "TAP version 13",
    "not ok 1 - known gap # TODO not implemented yet",
    "    not ok 2 - nested known gap # todo",
    "ok 3 - passing",
    "not ok 4 - real failure",
    "not ok 5 - later failure",
  ].join("\n");
  expect(firstFailingTest(tap)).toBe("real failure");
  // Same log as GitHub prints it: timestamp prefix, ANSI colour, CRLF.
  const ghLog = tap
    .split("\n")
    .map((line) => `Test job\tRun tests\t2026-11-09T05:00:00.0000000Z \x1b[31m${line}\x1b[0m`)
    .join("\r\n");
  expect(firstFailingTest(ghLog)).toBe("real failure");
});

test("a ✖ failure marked TODO is excluded from reported failures", () => {
  const ts = "Tests\tRun\t2026-11-09T05:00:00.0000000Z ";
  // Only TODO-marked failures: nothing to report.
  expect(firstFailingTest("✖ known broken (1.2ms) # TODO")).toBeNull();
  // GitHub log timestamp and ANSI colour do not defeat the marker.
  expect(firstFailingTest(`${ts}\u001b[31m✖ known broken (1ms) # TODO\u001b[39m`)).toBeNull();
  expect(firstFailingTest(`${ts}✗ known broken # TODO\n${ts}✖ real failure (2ms)`)).toBe(
    "real failure",
  );
  // The marker only exempts its own line; a later unmarked ✖ still reports.
  expect(firstFailingTest("✖ a # TODO\n✖ b # TODO\n✖ c")).toBe("c");
});

test("unmarked TAP failures are reported, including names that only resemble a directive", () => {
  expect(firstFailingTest("ok 1 - passing\nnot ok 2 - plain failure")).toBe("plain failure");
  expect(firstFailingTest("not ok 1 no dash failure")).toBe("no dash failure");
  expect(firstFailingTest("not ok 1 - handles #TODOS\nnot ok 2 - other")).toBe("handles #TODOS");
});

test("TODO in a failure name without a directive is reported", () => {
  expect(firstFailingTest("not ok 1 - handles TODO items\nnot ok 2 - later failure")).toBe(
    "handles TODO items",
  );
  expect(firstFailingTest("✖ handles TODO items (2ms)\n✖ later failure (1ms)")).toBe(
    "handles TODO items",
  );
});

test("one SKIP-marked failure and one unmarked failure report only the unmarked one", () => {
  const ts = "Tests\tRun\t2026-11-09T05:00:00.0000000Z ";
  for (const [skipped, unmarked] of [
    ["not ok 1 - flaky on windows # SKIP no tty", "not ok 2 - real failure"],
    ["✖ flaky on windows (1ms) # skip", "✖ real failure (2ms)"],
  ] as const) {
    // Order must not matter: the skipped line never wins, before or after the real one.
    for (const log of [`${skipped}\n${unmarked}`, `${unmarked}\n${skipped}`]) {
      const expected = firstFailingTest(log);
      expect(expected).toBe("real failure");
      const gh = log
        .split("\n")
        .map((line) => `${ts}\u001b[31m${line}\u001b[39m`)
        .join("\r\n");
      expect(firstFailingTest(gh)).toBe(expected);
    }
    // A lone SKIP-marked failure reports nothing.
    expect(firstFailingTest(skipped)).toBeNull();
  }
});

const job = (id: number, conclusion = "failure") => ({ id, name: `Tests ${id}`, conclusion });
const client: GhRunner = async (args, signal) => {
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal.aborted).toBe(false);
  if (args[0] === "api" && !args[1]?.includes("/jobs?")) return '{"default_branch":"release/main"}';
  if (args[1] === "list") {
    expect(args).toEqual([
      "run",
      "list",
      "--repo",
      expect.any(String),
      "--workflow",
      "CI",
      "--all",
      "--branch",
      "release/main",
      "--event",
      expect.stringMatching(/^(schedule|push)$/),
      "--status",
      "completed",
      "--limit",
      "1",
      "--json",
      "databaseId,conclusion",
    ]);
    return '[{"databaseId":42,"conclusion":"failure"}]';
  }
  if (args[0] === "api") {
    expect(args.slice(2)).toEqual(["--paginate", "--slurp"]);
    expect(args[1]).toEndWith("/actions/runs/42/jobs?filter=latest&per_page=100");
    return JSON.stringify([
      { total_count: 3, jobs: [job(1), job(2, "success")] },
      { total_count: 3, jobs: [job(3)] },
    ]);
  }
  expect(args).toEqual([
    "run",
    "view",
    "42",
    "--repo",
    expect.any(String),
    "--job",
    expect.stringMatching(/^(1|3)$/),
    "--log",
  ]);
  return fixtures[0]![1]!;
};

test("lists both latest completed CI events for all seven default branches and paginates failed jobs", async () => {
  const report = await collectFleetReds(client, 0);
  expect(report.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  expect(report.repos.map((r) => r.repo)).toEqual(DOCTOR_REPOS);
  for (const repo of report.repos) {
    expect(repo.status).toBe("ok");
    expect(repo.runs?.map((run) => run.event)).toEqual(["schedule", "push"]);
    expect(repo.runs?.[0]).toMatchObject({
      runId: 42,
      conclusion: "failure",
      jobs: [
        { name: "Tests 1", firstFailingTest: fixtures[0]![2], logStatus: "parsed" },
        { name: "Tests 3", firstFailingTest: fixtures[0]![2], logStatus: "parsed" },
      ],
    });
  }
});
test("reports real TAP failures without reporting TODO failures", async () => {
  const report = await collectFleetReds(async (args, signal) => {
    if (!args.includes("--job")) return client(args, signal);
    const todo =
      "Test job\tRun tests\t2026-10-30T12:00:00.1234567Z not ok 1 - expected failure # TODO pending fix";
    return args.includes("1") ? todo : `${todo}\nnot ok 2 - actual failure`;
  });
  for (const repo of report.repos) {
    for (const run of repo.runs ?? []) {
      expect(run.jobs).toEqual([
        { name: "Tests 1", firstFailingTest: null, logStatus: "unrecognized" },
        { name: "Tests 3", firstFailingTest: "actual failure", logStatus: "parsed" },
      ]);
    }
  }
});
test("newer green and absent completed runs never fetch historical failures or logs", async () => {
  const report = await collectFleetReds(async (args, signal) =>
    args[1] === "list"
      ? args.includes("push")
        ? "[]"
        : '[{"databaseId":43,"conclusion":"success"}]'
      : client(args, signal),
  );
  expect(report.repos[0]?.runs?.map((run) => [run.status, run.jobs])).toEqual([
    ["ok", []],
    ["no-runs", []],
  ]);
});
test("isolates missing metadata, event failures and expired logs without echoing errors", async () => {
  const report = await collectFleetReds(async (args, signal) => {
    if (args[1] === "repos/ashlrai/phantom") throw new Error("private stderr");
    if (args.includes("push")) return "null";
    if (args.includes("--job")) throw new Error("private stderr");
    return client(args, signal);
  });
  expect(report.repos[0]?.runs?.[0]).toMatchObject({
    status: "partial",
    jobs: [
      { name: "Tests 1", firstFailingTest: null, logStatus: "unavailable" },
      { name: "Tests 3", firstFailingTest: null, logStatus: "unavailable" },
    ],
  });
  expect(report.repos[0]?.runs?.[1]?.status).toBe("unavailable");
  expect(report.repos[1]).toMatchObject({ status: "unavailable", runs: null });
  expect(JSON.stringify(report)).not.toContain("private stderr");
});
test("malformed or truncated job pages remain unavailable; unrecognized logs preserve failed jobs", async () => {
  for (const response of [
    "{}",
    "[]",
    '[{"total_count":2,"jobs":[]}]',
    '[{"total_count":1,"jobs":[{}]}]',
  ]) {
    const report = await collectFleetReds(async (args, signal) =>
      args[1]?.includes("/jobs?") ? response : client(args, signal),
    );
    expect(report.repos[0]?.runs?.[0]?.status).toBe("unavailable");
  }
  const report = await collectFleetReds(async (args, signal) =>
    args.includes("--job") ? "build failed" : client(args, signal),
  );
  expect(report.repos[0]?.runs?.[0]?.jobs?.[0]).toEqual({
    name: "Tests 1",
    firstFailingTest: null,
    logStatus: "unrecognized",
  });
});
test("malformed later jobs do not expose a partial job list as a complete result", async () => {
  const report = await collectFleetReds(async (args, signal) =>
    args[1]?.includes("/jobs?")
      ? JSON.stringify([{ total_count: 2, jobs: [job(1), { id: 2 }] }])
      : client(args, signal),
  );
  expect(report.repos[0]?.runs?.[0]).toMatchObject({ status: "unavailable", jobs: null });
});
test("invalid run metadata is unknown, and infrastructure failures can have no job logs", async () => {
  for (const response of [
    "null",
    "{}",
    '[{"databaseId":0,"conclusion":"failure"}]',
    '[{"databaseId":42,"conclusion":"unexpected"}]',
  ]) {
    const report = await collectFleetReds(async (args, signal) =>
      args[1] === "list" ? response : client(args, signal),
    );
    expect(report.repos[0]?.runs?.[0]).toMatchObject({ status: "unavailable", jobs: null });
  }
  const report = await collectFleetReds(async (args, signal) =>
    args[1]?.includes("/jobs?") ? '[{"total_count":0,"jobs":[]}]' : client(args, signal),
  );
  expect(report.repos[0]?.runs?.[0]).toMatchObject({
    status: "partial",
    conclusion: "failure",
    jobs: [],
  });
});

test("CLI uses Locus, emits one JSON document by default and registers help and completions", async () => {
  const home = await mkdtemp(join(tmpdir(), "fleet-reds-"));
  try {
    await writeFile(
      join(home, "locus"),
      `#!/bin/sh\n[ "$1 $2 $3" = "exec -- gh" ] || exit 2\ncase "$4 $5" in\n"api "*) echo '{"default_branch":"main"}' ;;\n"run list") echo '[]' ;;\n*) exit 3 ;;\nesac\n`,
      { mode: 0o755 },
    );
    const cli = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, "packages/cli/src/index.ts", ...args], {
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
    for (const args of [[], ["--json"]]) {
      const report = JSON.parse(await cli("fleet-reds", ...args));
      expect(report.schemaVersion).toBe(1);
      expect(report.repos).toHaveLength(7);
      expect(report.repos.every((r: { status: string }) => r.status === "ok")).toBe(true);
    }
    expect(await cli("fleet-reds", "--help")).toContain("--json");
    expect(await cli("--help")).toContain("fleet-reds");
    for (const shell of ["bash", "zsh", "fish"])
      expect(await cli("completion", shell)).toContain("fleet-reds");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000); // Seven CLI subprocesses include root help, which loads every command.

test("an unmarked TAP failure in a job log is included in the reported failures", async () => {
  const tap = [
    "TAP version 13",
    "not ok 1 - expected failure # TODO",
    "not ok 2 - flaky # SKIP",
    "not ok 3 - handles TODO items",
  ].join("\n");
  const report = await collectFleetReds(async (args, signal) =>
    args.includes("--job") ? tap : client(args, signal),
  );
  expect(report.repos[0]?.runs?.[0]?.jobs).toEqual([
    { name: "Tests 1", firstFailingTest: "handles TODO items", logStatus: "parsed" },
    { name: "Tests 3", firstFailingTest: "handles TODO items", logStatus: "parsed" },
  ]);
});
