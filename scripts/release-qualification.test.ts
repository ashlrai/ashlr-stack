import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workflow = readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");
const git = Bun.which("git");
if (!git) throw new Error("Git is required for release qualification fixtures");

function step(name: string) {
  const tail = workflow.split(`name: ${name}\n`)[1];
  if (!tail) throw new Error(`Missing workflow step: ${name}`);
  const lines = tail.split("        run: |\n")[1]?.split("\n");
  if (!lines) throw new Error(`Missing shell block: ${name}`);
  const block: string[] = [];
  for (const line of lines) {
    if (line && !line.startsWith("          ")) break;
    block.push(line.slice(10));
  }
  return block.join("\n");
}

let root: string;
let env: Record<string, string>;
let sha: string;

async function run(argv: string[], input?: string) {
  const child = Bun.spawn(argv, {
    cwd: root,
    env,
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { status, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

async function command(args: string[], input?: string) {
  const result = await run([git as string, ...args], input);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function evidence(
  runs: unknown = [
    {
      event: "workflow_dispatch",
      head_sha: sha,
      status: "completed",
      conclusion: "success",
    },
  ],
) {
  writeFileSync(join(root, "runs.json"), JSON.stringify({ workflow_runs: runs }));
}

async function qualify() {
  writeFileSync(env.GITHUB_OUTPUT, "");
  writeFileSync(join(root, "gh-calls"), "");
  return run(["/bin/bash", "-c", step("Require manual full CI on the resolved release commit")]);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "stack-release-qualification-"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "home"));
  // Explicit fixture environment: no host Git config, credentials or signing.
  env = {
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    HOME: join(root, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    RUNNER_TEMP: root,
    GITHUB_OUTPUT: join(root, "output"),
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: "f".repeat(40),
    REPO: "fixture/stack",
    REPO_URL: `file://${join(root, "repo.git")}`,
    RELEASE_TAG: "v0.3.2",
    INPUT_TAG: "v0.3.2",
    INPUT_VERSION: "",
    CI_WORKFLOW: "ci.yml",
    RELEASE_INPUT_OTP: "",
    FIXTURE_ROOT: root,
  };
  writeFileSync(
    join(root, "bin/gh"),
    `#!/bin/bash
printf '%s\\n' "$*" >> "$FIXTURE_ROOT/gh-calls"
cat "$FIXTURE_ROOT/runs.json"
exit "\${FIXTURE_API_EXIT:-0}"
`,
    { mode: 0o700 },
  );
  await command(["init", "--bare", "repo.git"]);
  const tree = await command(["--git-dir=repo.git", "mktree"], "");
  sha = await command(
    ["--git-dir=repo.git", "-c", "commit.gpgsign=false", "commit-tree", tree],
    "fixture\n",
  );
  await command(["--git-dir=repo.git", "update-ref", "refs/tags/v0.3.2", sha]);
  evidence();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("main dispatch qualifies the lightweight tag commit, independently of main SHA", async () => {
  expect((await qualify()).status).toBe(0);
  expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe(`sha=${sha}\n`);
  const calls = readFileSync(join(root, "gh-calls"), "utf8");
  expect(calls).toContain(`head_sha=${sha}&`);
  expect(calls).not.toContain(env.GITHUB_SHA);
});

test("annotated tags qualify their peeled commit, not the tag object", async () => {
  const tag = await command(
    ["--git-dir=repo.git", "mktag"],
    `object ${sha}\ntype commit\ntag v0.3.2\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\nfixture\n`,
  );
  await command(["--git-dir=repo.git", "update-ref", "refs/tags/v0.3.2", tag]);
  expect((await qualify()).status).toBe(0);
  expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe(`sha=${sha}\n`);
});

test("version-only and matching tag/version dispatches keep the same qualification", async () => {
  env.INPUT_VERSION = "0.3.2";
  for (const tag of ["", "v0.3.2"]) {
    env.INPUT_TAG = tag;
    expect((await qualify()).status).toBe(0);
  }
});

for (const patch of [
  { head_sha: "f".repeat(40) },
  { event: "schedule" },
  { status: "in_progress" },
  { conclusion: "failure" },
  { conclusion: "cancelled" },
]) {
  test(`CI evidence refuses ${JSON.stringify(patch)}`, async () => {
    evidence([
      {
        event: "workflow_dispatch",
        head_sha: sha,
        status: "completed",
        conclusion: "success",
        ...patch,
      },
    ]);
    expect((await qualify()).status).not.toBe(0);
    expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
  });
}

for (const runs of [[], null, {}, [null]]) {
  test(`absent or malformed CI evidence refuses ${JSON.stringify(runs)}`, async () => {
    evidence(runs);
    expect((await qualify()).status).not.toBe(0);
    expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
  });
}

test("API failures refuse even when their stdout resembles successful evidence", async () => {
  env.FIXTURE_API_EXIT = "1";
  expect((await qualify()).status).not.toBe(0);
  expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
});

test("an object masquerading as a run list cannot qualify", async () => {
  evidence({
    run: { event: "workflow_dispatch", head_sha: sha, status: "completed", conclusion: "success" },
  });
  expect((await qualify()).status).not.toBe(0);
  expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
});

test("missing tags and tags targeting non-commit objects refuse before CI lookup", async () => {
  await command(["--git-dir=repo.git", "update-ref", "-d", "refs/tags/v0.3.2"]);
  expect((await qualify()).status).not.toBe(0);
  const blob = await command(["--git-dir=repo.git", "hash-object", "-w", "--stdin"], "blob");
  await command(["--git-dir=repo.git", "update-ref", "refs/tags/v0.3.2", blob]);
  expect((await qualify()).status).not.toBe(0);
  expect(readFileSync(join(root, "gh-calls"), "utf8")).toBe("");
});

test("tag pushes must still match the triggering commit", async () => {
  env.GITHUB_EVENT_NAME = "push";
  env.GITHUB_REF = "refs/tags/v0.3.2";
  expect((await qualify()).status).not.toBe(0);
  expect(readFileSync(join(root, "gh-calls"), "utf8")).toBe("");
  env.GITHUB_SHA = sha;
  expect((await qualify()).status).toBe(0);
});

test("invalid dispatch inputs and unsupported OTP refuse before git or API work", async () => {
  for (const patch of [
    { INPUT_TAG: "", RELEASE_TAG: "v" },
    { INPUT_VERSION: "0.3.3" },
    { INPUT_VERSION: "invalid" },
    { INPUT_TAG: "v0.3.2;false", RELEASE_TAG: "v0.3.2;false" },
    { RELEASE_INPUT_OTP: "synthetic-otp-secret" },
  ]) {
    const previous = { ...env };
    Object.assign(env, patch);
    // An invalid scratch directory makes any premature git setup observable.
    env.RUNNER_TEMP = join(root, "absent");
    const result = await qualify();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("synthetic-otp-secret");
    expect(result.stderr).not.toContain("mktemp");
    expect(readFileSync(join(root, "gh-calls"), "utf8")).toBe("");
    env = previous;
  }
});

test("GitHub release refuses a tag that changed after source qualification", async () => {
  await command(["init", "checkout"]);
  await command(["-C", "checkout", "fetch", env.REPO_URL, "refs/tags/v0.3.2:refs/tags/v0.3.2"]);
  await command(["-C", "checkout", "checkout", "--detach", sha]);
  env.RELEASE_INPUT_VERSION = "";
  const script = `cd checkout\n${step("Resolve version")}`;
  expect((await run(["/bin/bash", "-c", script])).status).toBe(0);
  const tree = await command(["--git-dir=repo.git", "mktree"], "");
  const moved = await command(
    ["-C", "checkout", "-c", "commit.gpgsign=false", "commit-tree", tree],
    "moved\n",
  );
  await command(["-C", "checkout", "update-ref", "refs/tags/v0.3.2", moved]);
  writeFileSync(env.GITHUB_OUTPUT, "");
  const result = await run(["/bin/bash", "-c", script]);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("release tag changed after qualification");
  expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
});

test("every release source checkout uses the successful gate's immutable commit", () => {
  const jobs = workflow.split(/^ {2}(?=[a-z][a-z-]+:\n)/m);
  for (const name of ["build-binaries", "publish-npm", "create-release", "update-homebrew-tap"]) {
    const job = jobs.find((block) => block.startsWith(`${name}:\n`));
    expect(job).toBeDefined();
    expect(job).toMatch(/needs: \[[^\]\n]*full-suite-evidence/);
    const checkout = job?.split(/uses: actions\/checkout@[^\n]+\n/)[1];
    expect(checkout?.split(/\n {6}- /)[0]).toContain(
      "ref: ${{ needs.full-suite-evidence.outputs.sha }}",
    );
  }
  expect(workflow).not.toContain("ref: refs/tags/${{ env.RELEASE_TAG }}");
});
