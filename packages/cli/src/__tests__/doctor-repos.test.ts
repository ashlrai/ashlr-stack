import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCTOR_REPOS, type GhRunner, checkRepos, runGh } from "../lib/doctor-repos.ts";

const metadata = JSON.stringify({
  data: {
    repository: {
      defaultBranchRef: { name: "trunk" },
      pullRequests: { totalCount: 123 },
    },
  },
});
const mockGh =
  (conclusion = "success", status = "completed"): GhRunner =>
  async (args) =>
    args[0] === "api" ? metadata : JSON.stringify([{ status, conclusion }]);

test("seven repositories use their actual default branch and exact PR total", async () => {
  const calls: string[][] = [];
  const signals: AbortSignal[] = [];
  const report = await checkRepos(async (args, signal) => {
    calls.push(args);
    signals.push(signal);
    return mockGh()(args, signal);
  });
  expect(report).toMatchObject({ kind: "ashlr.doctor", schema_version: 1, status: "ok" });
  expect(report.repos.map((r) => r.repo)).toEqual(DOCTOR_REPOS);
  expect(new Set(signals).size).toBe(7);
  expect(
    calls.filter((a) => a[0] === "run").every((a) => a[a.indexOf("--branch") + 1] === "trunk"),
  ).toBe(true);
  expect(report.repos.every((r) => r.open_pr_count === 123 && r.ci_conclusion === "success")).toBe(
    true,
  );
});

test("failures fail; pending, absent and cancelled workflows warn", async () => {
  expect((await checkRepos(mockGh("failure"))).status).toBe("fail");
  for (const runner of [mockGh("", "in_progress"), mockGh("cancelled"), async () => "[]"]) {
    expect((await checkRepos(runner)).status).toBe("warn");
  }
  const absent = await checkRepos(async (a, s) => (a[0] === "api" ? metadata : "[]"));
  expect(absent.repos[0].detail).toContain("no default-branch");
});

test("offline, missing gh, invalid JSON and GraphQL errors are safe warnings", async () => {
  for (const runner of [
    async () => {
      throw new Error("private token stderr");
    },
    async () => "invalid",
    async () => JSON.stringify({ errors: [{ message: "private" }] }),
  ]) {
    const report = await checkRepos(runner);
    expect(report.repos).toHaveLength(7);
    expect(report.status).toBe("warn");
    expect(JSON.stringify(report)).not.toContain("private");
    expect(report.repos.every((r) => r.open_pr_count === null)).toBe(true);
  }
});

test("a timed out repo preserves metadata and does not hide healthy peers", async () => {
  const report = await checkRepos(async (args, signal) => {
    if (args[0] === "run" && args.includes("ashlrai/phantom"))
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error()), { once: true }),
      );
    return mockGh()(args, signal);
  }, 20);
  expect(report.repos.filter((r) => r.status === "ok")).toHaveLength(6);
  expect(report.repos[1]).toMatchObject({
    open_pr_count: 123,
    ci_conclusion: null,
    detail: "repository check timed out",
  });
});

test("CLI emits one JSON envelope without project config; real runner kills hanging gh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-repos-"));
  try {
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/sh\ncase "$1" in\napi) echo '${metadata}' ;;\n*) echo '[{"status":"completed","conclusion":"failure"}]' ;;\nesac\n`,
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, STACK_NO_UPDATE_CHECK: "1" };
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dir, "../index.ts"), "doctor", "--repos", "--json"],
      { cwd: dir, env, encoding: "utf8", timeout: 15000 },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "fail", repos: expect.any(Array) });
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = env.PATH;
      writeFileSync(join(dir, "gh"), "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
      expect(await checkRepos(runGh, 20)).toMatchObject({ status: "warn" });
    } finally {
      process.env.PATH = originalPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
