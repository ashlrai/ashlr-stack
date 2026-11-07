import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FleetGcReport, collectFleetGc, parseWorktreePorcelain } from "./fleet-gc.ts";

const git = (cwd: string, args: string[]) =>
  spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

const must = (r: ReturnType<typeof git>) => {
  if (r.status !== 0) throw new Error(`git failed: ${r.stderr}`);
  return r.stdout.trim();
};

/** Everything is created "now"; tests pass a future `now` to simulate idle time. */
const IDLE = 8 * 3_600_000;
const at = (offsetMs = IDLE) => Date.now() + offsetMs;

interface Fx {
  home: string;
  root: string;
  runs: string;
  queue: string;
  repo: string;
  baseSha: string;
  ghState: string;
  lsofHolds: string[];
}

async function stub(dir: string, name: string, body: string) {
  const p = join(dir, name);
  await writeFile(p, `#!/bin/sh\n${body}\n`);
  await chmod(p, 0o755);
  return p;
}

async function fixture(): Promise<Fx> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "fleet-gc-")));
  const projects = join(home, "projects");
  const root = join(projects, "wt");
  const repo = join(projects, "phantom");
  const runs = join(home, "runs");
  const queue = join(runs, "queue");
  const runDir = join(queue, "run");
  for (const d of [root, repo, runDir, join(runs, "g1-pass"), join(runs, "metrics")])
    await mkdir(d, { recursive: true });

  must(git(repo, ["init", "-b", "main"]));
  await writeFile(join(repo, "file.txt"), "base\n");
  must(git(repo, ["add", "file.txt"]));
  must(git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]));
  const baseSha = must(git(repo, ["rev-parse", "HEAD"]));
  must(git(repo, ["update-ref", "refs/remotes/origin/main", baseSha]));
  must(git(repo, ["update-ref", "refs/remotes/fork/main", baseSha]));

  // Valid pinned hold list: phantom #197.
  const rules = "# rules\n7. Hold list: phantom #197 #878.\n";
  await writeFile(join(runs, "ENGINEER-RULES.md"), rules);
  await writeFile(
    join(runs, "ENGINEER-RULES.md.sha256"),
    `${createHash("sha256").update(rules).digest("hex")}  ENGINEER-RULES.md\n`,
  );

  return {
    home,
    root,
    runs,
    queue,
    repo,
    baseSha,
    ghState: "MERGED",
    lsofHolds: [],
  };
}

async function cleanup(fx: Fx) {
  await rm(fx.home, { recursive: true, force: true });
}

/** gh stub honoring fx.ghState; lsof stub honoring fx.lsofHolds paths. */
async function tools(fx: Fx) {
  const ghBin = await stub(fx.home, "gh-stub", `case "$*" in *state*) echo ${fx.ghState};; esac`);
  const lines = fx.lsofHolds.map((p) => `n${p}`).join("\\n");
  const lsofBin = await stub(fx.home, "lsof-stub", lines ? `printf 'p1\\n${lines}\\n'` : "exit 0");
  return { ghBin, lsofBin };
}

interface JobOpts {
  branch?: string;
  pool?: string;
  wt?: boolean;
  publish?: string | null;
  log?: string | null;
  base?: string | null;
  detached?: boolean;
}

/** Register a fleet job: worktree + .base + optional .log/.publish, all "now". */
async function seed(fx: Fx, name: string, opts: JobOpts = {}) {
  const wt = join(fx.root, name);
  const branch = opts.branch ?? `codex-bridge/${name}`;
  if (opts.wt !== false) {
    const args = opts.detached
      ? ["worktree", "add", "--detach", wt, fx.baseSha]
      : ["worktree", "add", "-b", branch, wt, fx.baseSha];
    must(git(fx.repo, args));
  } else {
    await mkdir(wt, { recursive: true });
  }
  if (opts.base !== null) {
    await writeFile(
      join(fx.runs, `${name}.base`),
      typeof opts.base === "string"
        ? opts.base
        : `${fx.baseSha} ${branch} ${wt} ${opts.pool ?? "devin"}\n`,
    );
  }
  if (opts.log !== null) {
    await writeFile(
      join(fx.runs, `${name}.log`),
      opts.log ?? "agent output\ntokens used\n12,345\n",
    );
  }
  if (opts.publish) await writeFile(join(fx.runs, `${name}.publish`), opts.publish);
  return { wt, branch };
}

const entry = (report: FleetGcReport, name: string) => {
  const e = report.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no entry ${name}`);
  return e;
};

const collect = (fx: Fx, extra: Partial<Parameters<typeof collectFleetGc>[0]> = {}) =>
  tools(fx).then((t) =>
    collectFleetGc({
      root: fx.root,
      runs: fx.runs,
      now: at(),
      ghBin: t.ghBin,
      lsofBin: t.lsofBin,
      ...extra,
    }),
  );

test("parseWorktreePorcelain parses -z records", () => {
  const text =
    "worktree /a/b\0HEAD abc123\0branch refs/heads/x\0\0" +
    "worktree /c/d\0HEAD def456\0detached\0locked reason\0prunable why\0\0";
  const wts = parseWorktreePorcelain(text);
  expect(wts).toHaveLength(2);
  expect(wts[0]).toMatchObject({ path: "/a/b", head: "abc123", branch: "refs/heads/x" });
  expect(wts[1]).toMatchObject({ path: "/c/d", detached: true, locked: true, prunable: true });
});

test("RESULT PR + merged gh state + clean idle worktree is a collect-candidate", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-PR1", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/4242 shipped\n",
    });
    const report = await collect(fx);
    const e = entry(report, "RQ-GC-PR1");
    expect(e.class).toBe("collect-candidate");
    expect(e.basis).toBe("result-pr");
    expect(e.resultClass).toBe("pr");
    expect(e.pr).toBe("ashlrai/phantom#4242");
    expect(report.mode).toBe("dry-run");
    expect(report.scan.ghCalls).toBe(1);
  } finally {
    await cleanup(fx);
  }
});

test("RESULT PR with OPEN gh state preserves (pr-open)", async () => {
  const fx = await fixture();
  try {
    fx.ghState = "OPEN";
    await seed(fx, "RQ-GC-PR2", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/7 x\n",
    });
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-PR2")).toMatchObject({ class: "preserve", reasons: ["pr-open"] });
  } finally {
    await cleanup(fx);
  }
});

test("RESULT PR preserves when gh is unavailable or errors", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-PR3", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/9 x\n",
    });
    const t = await tools(fx);
    const report = await collectFleetGc({
      root: fx.root,
      runs: fx.runs,
      now: at(),
      ghBin: "/nonexistent/gh",
      lsofBin: t.lsofBin,
    });
    expect(entry(report, "RQ-GC-PR3").reasons).toContain("gh-unavailable");
    expect(report.tools.gh).toBe("unavailable");
    const report2 = await collect(fx, { ghMax: 0 });
    expect(entry(report2, "RQ-GC-PR3").reasons).toContain("gh-budget");
    expect(report2.tools.gh).toBe("unused");
  } finally {
    await cleanup(fx);
  }
});

test("malformed RESULT PR line is supervisor-kept, never a candidate", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-PR4", { publish: "RESULT PR not-a-url\n" });
    await seed(fx, "RQ-GC-PR5", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/12345678 toolong\n",
    });
    await seed(fx, "RQ-GC-PR6", { publish: "RESULT PR https://evil.example/x/pull/1 x\n" });
    const report = await collect(fx);
    for (const n of ["RQ-GC-PR4", "RQ-GC-PR5", "RQ-GC-PR6"])
      expect(entry(report, n).reasons[0]).toMatch(/^kept-supervisor:/);
    expect(report.scan.ghCalls).toBe(0);
  } finally {
    await cleanup(fx);
  }
});

test("RESULT PR for an unlisted repo preserves (repo-unlisted)", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-PR7", {
      publish: "RESULT PR https://github.com/ashlrai/notarepo/pull/5 x\n",
    });
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-PR7").reasons).toContain("repo-unlisted");
  } finally {
    await cleanup(fx);
  }
});

test("RESULT EMPTY clean-at-base idle worktree is a collect-candidate", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-EM1", { publish: "RESULT EMPTY (dispatchd: no changes)\n" });
    const report = await collect(fx);
    const e = entry(report, "RQ-GC-EM1");
    expect(e).toMatchObject({ class: "collect-candidate", basis: "result-empty" });
    expect(report.scan.ghCalls).toBe(0);
  } finally {
    await cleanup(fx);
  }
});

test("DONE-NOOP (precheck skip, no .publish) clean-at-base is a candidate", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-NO1", { publish: null });
    await writeFile(
      join(fx.queue, "precheck-skips.tsv"),
      "2026-01-01T00:00:00Z\tRQ-GC-NO1\t10\tnoop\n",
    );
    await writeFile(
      join(fx.queue, "run", "RQ-GC-NO1.line"),
      "RQ-GC-NO1\tphantom\tdevin\twork\tp\n",
    );
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-NO1")).toMatchObject({
      class: "collect-candidate",
      basis: "done-noop",
    });
  } finally {
    await cleanup(fx);
  }
});

test("inferred DONE-EMPTY via log end marker is a candidate", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-INF1", { publish: null, log: "work\nmore\ntokens used\n9,999\n" });
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-INF1")).toMatchObject({
      class: "collect-candidate",
      basis: "empty-inferred",
    });
  } finally {
    await cleanup(fx);
  }
});

test("API_SPEND log end marker infers DONE-EMPTY", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-SPD1", {
      publish: null,
      log: `agent output\nmore lines\nAPI_SPEND RQ-GC-SPD1 pool=gift tokens=123\n`,
    });
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-SPD1")).toMatchObject({
      class: "collect-candidate",
      basis: "empty-inferred",
    });
  } finally {
    await cleanup(fx);
  }
});

test("no .publish and no end marker preserves (log-no-end-marker)", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-INF2", { publish: null, log: "partial output\n" });
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-INF2").reasons).toContain("log-no-end-marker");
  } finally {
    await cleanup(fx);
  }
});

test("dirty worktree preserves", async () => {
  const fx = await fixture();
  try {
    const { wt } = await seed(fx, "RQ-GC-DIR1", { publish: "RESULT EMPTY x\n" });
    await writeFile(join(wt, "notes.txt"), "untracked\n");
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-DIR1").reasons).toContain("dirty");
  } finally {
    await cleanup(fx);
  }
});

/** Ignore patterns via the repo's common info/exclude (per-worktree gitdir info/exclude is not read). */
async function exclude(fx: Fx, patterns: string) {
  const p = join(fx.repo, ".git", "info", "exclude");
  await mkdir(join(fx.repo, ".git", "info"), { recursive: true });
  await writeFile(p, patterns);
}

test("ignored files: non-allowlisted paths preserve on the inferred path", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-IG1", { publish: null, log: "x\ntokens used\n1\n" });
    await seed(fx, "RQ-GC-IG2", { publish: null, log: "x\ntokens used\n1\n" });
    await exclude(fx, "secrets-gc.env\ndist-gc/\n");
    await writeFile(join(fx.root, "RQ-GC-IG1", "secrets-gc.env"), "x\n");
    await mkdir(join(fx.root, "RQ-GC-IG2", "dist-gc"), { recursive: true });
    await writeFile(join(fx.root, "RQ-GC-IG2", "dist-gc", "out.js"), "x\n");
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-IG1").reasons).toContain("ignored-files");
    expect(entry(report, "RQ-GC-IG2").reasons).toContain("ignored-files");
  } finally {
    await cleanup(fx);
  }
});

test("ignored build-artifact dirs pass the inferred-path allowlist", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-IG3", { publish: null, log: "x\ntokens used\n1\n" });
    await exclude(fx, "node_modules/\n");
    await mkdir(join(fx.root, "RQ-GC-IG3", "node_modules"), { recursive: true });
    await writeFile(join(fx.root, "RQ-GC-IG3", "node_modules", "pkg.js"), "x\n");
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-IG3")).toMatchObject({
      class: "collect-candidate",
      basis: "empty-inferred",
    });
  } finally {
    await cleanup(fx);
  }
});

test("unpushed commits preserve a RESULT PR candidate", async () => {
  const fx = await fixture();
  try {
    const { wt } = await seed(fx, "RQ-GC-UP1", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/11 x\n",
    });
    await writeFile(join(wt, "wip.txt"), "x\n");
    must(git(wt, ["add", "wip.txt"]));
    must(git(wt, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "wip"]));
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-UP1").reasons).toContain("unpushed-commits");
  } finally {
    await cleanup(fx);
  }
});

test("commits ahead of base preserve empty-family candidates (unpublished-work)", async () => {
  const fx = await fixture();
  try {
    const { wt } = await seed(fx, "RQ-GC-UP2", { publish: "RESULT EMPTY x\n" });
    await writeFile(join(wt, "wip.txt"), "x\n");
    must(git(wt, ["add", "wip.txt"]));
    must(git(wt, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "wip"]));
    must(
      git(fx.repo, [
        "update-ref",
        "refs/remotes/fork/codex-bridge/RQ-GC-UP2",
        must(git(wt, ["rev-parse", "HEAD"])),
      ]),
    );
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-UP2").reasons).toContain("unpublished-work");
  } finally {
    await cleanup(fx);
  }
});

test("tier-1 markers all preserve: dispatched, reaping, locks, pid, keep, queued, status", async () => {
  const fx = await fixture();
  try {
    const cases: [string, (fx: Fx) => Promise<void>, string][] = [
      [
        "RQ-GC-M-DS",
        (f) => writeFile(join(f.queue, "run", "RQ-GC-M-DS.dispatched"), "1"),
        "dispatch-pending",
      ],
      [
        "RQ-GC-M-RP",
        (f) => writeFile(join(f.queue, "run", "RQ-GC-M-RP.reaping"), ""),
        "reap-claimed",
      ],
      ["RQ-GC-M-LK", (f) => writeFile(join(f.queue, "run", "RQ-GC-M-LK.lock"), ""), "lock-claimed"],
      [
        "RQ-GC-M-PD",
        (f) => writeFile(join(f.runs, "RQ-GC-M-PD.pid"), `${process.pid}\n`),
        "process-live",
      ],
      [
        "RQ-GC-M-PS",
        (f) => writeFile(join(f.queue, "run", "RQ-GC-M-PS.pid"), "999999\n"),
        "pid-stale",
      ],
      ["RQ-GC-M-PU", (f) => writeFile(join(f.runs, "RQ-GC-M-PU.pid"), "abc\n"), "pid-unknown"],
    ];
    for (const [name, mark] of cases) {
      await seed(fx, name, { publish: "RESULT PR https://github.com/ashlrai/phantom/pull/3 x\n" });
      await mark(fx);
    }
    await seed(fx, "RQ-GC-M-KEEP", { publish: "RESULT EMPTY x\n" });
    await writeFile(join(fx.queue, "keep.txt"), "RQ-GC-M-KEEP\n");
    await seed(fx, "RQ-GC-M-QUE", { publish: "RESULT EMPTY x\n" });
    await writeFile(join(fx.queue, "ready.tsv"), "RQ-GC-M-QUE\tphantom\tdevin\twork\tp\n");
    await seed(fx, "RQ-GC-M-ST", { publish: "RESULT EMPTY x\n" });
    await writeFile(
      join(fx.queue, "status.json"),
      JSON.stringify({ kept_worktrees: ["RQ-GC-M-ST"], reaping: [] }),
    );
    const report = await collect(fx);
    for (const [name, , reason] of cases) expect(entry(report, name).reasons).toContain(reason);
    expect(entry(report, "RQ-GC-M-KEEP").reasons).toContain("kept");
    expect(entry(report, "RQ-GC-M-QUE").reasons).toContain("job-queued");
    expect(entry(report, "RQ-GC-M-ST").reasons).toContain("status-kept");
  } finally {
    await cleanup(fx);
  }
});

test("hold list and publish-queue gates", async () => {
  const fx = await fixture();
  try {
    // empty-family job whose .line references held PR 197
    await seed(fx, "RQ-GC-HLD1", { publish: "RESULT EMPTY x\n" });
    await writeFile(
      join(fx.queue, "run", "RQ-GC-HLD1.line"),
      "RQ-GC-HLD1\tphantom\tdevin\twork\tsee #197\n",
    );
    // landonly + g1-pass members
    await seed(fx, "RQ-GC-HLD2", { publish: "RESULT EMPTY x\n" });
    await writeFile(join(fx.runs, "PUBLISH_LANDONLY"), "RQ-GC-HLD2\n");
    await seed(fx, "RQ-GC-HLD3", { publish: "RESULT EMPTY x\n" });
    await writeFile(join(fx.runs, "g1-pass", "RQ-GC-HLD3.pass"), "");
    // RESULT PR matching the hold list repo#pr
    await seed(fx, "RQ-GC-HLD4", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/197 x\n",
    });
    // landonly member with RESULT PR is NOT gated (merged-mode parity)
    await seed(fx, "RQ-GC-HLD5", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/55 x\n",
    });
    await writeFile(join(fx.runs, "PUBLISH_LANDONLY"), "RQ-GC-HLD2\nRQ-GC-HLD5\n");
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-HLD1").reasons).toContain("held");
    expect(entry(report, "RQ-GC-HLD2").reasons).toContain("publish-queued");
    expect(entry(report, "RQ-GC-HLD3").reasons).toContain("publish-queued");
    expect(entry(report, "RQ-GC-HLD4").reasons).toContain("hold-list");
    expect(entry(report, "RQ-GC-HLD5")).toMatchObject({
      class: "collect-candidate",
      basis: "result-pr",
    });
  } finally {
    await cleanup(fx);
  }
});

test("protected branches and claude push-age gate", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-BR1", { branch: "codex/manual1", publish: "RESULT EMPTY x\n" });
    await seed(fx, "RQ-GC-BR2", { branch: "claude/manual2", publish: "RESULT EMPTY x\n" });
    await seed(fx, "RQ-GC-BR3", {
      branch: "claude/manual3",
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/21 x\n",
    });
    await seed(fx, "RQ-GC-BR4", {
      branch: "codex/manual4",
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/22 x\n",
    });
    const report = await collect(fx, { now: at(20 * 60_000) }); // 20min idle: past live window, under thresholds
    expect(entry(report, "RQ-GC-BR1").reasons).toContain("protected-branch");
    expect(entry(report, "RQ-GC-BR2").reasons).toContain("protected-branch");
    expect(entry(report, "RQ-GC-BR3").reasons).toContain("claude-recent-push");
    expect(entry(report, "RQ-GC-BR4").reasons).toContain("protected-branch");
    const report2 = await collect(fx); // 8h idle: claude push age satisfied but idle threshold still applies per basis
    expect(entry(report2, "RQ-GC-BR3").class).toBe("collect-candidate");
  } finally {
    await cleanup(fx);
  }
});

test("kept-for-supervisor result classes always preserve", async () => {
  const fx = await fixture();
  try {
    for (const [name, res] of [
      ["RQ-GC-SV1", "RESULT DENIED no\n"],
      ["RQ-GC-SV2", "RESULT ABORT timeout\n"],
      ["RQ-GC-SV3", "RESULT ARCHIVED abc 1 base ts\n"],
      ["RQ-GC-SV4", "RESULT PR-LOOKALIKE https://x\n"],
      ["RQ-GC-SV5", "weird output\n"],
    ] as const) {
      await seed(fx, name, { publish: res });
    }
    const report = await collect(fx);
    for (const name of ["RQ-GC-SV1", "RQ-GC-SV2", "RQ-GC-SV3", "RQ-GC-SV4"]) {
      const e = entry(report, name);
      expect(e.class).toBe("preserve");
      expect(e.reasons[0]).toMatch(/^kept-supervisor:/);
    }
    // a .publish with no RESULT line at all is unresulted, still preserved
    expect(entry(report, "RQ-GC-SV5").reasons).toContain("publish-unresulted");
  } finally {
    await cleanup(fx);
  }
});

test("registration and pointer failures preserve", async () => {
  const fx = await fixture();
  try {
    // unregistered: .git pointer resolves but worktree list lacks the path
    const wt = join(fx.root, "RQ-GC-REG1");
    await mkdir(join(fx.repo, ".git", "worktrees", "RQ-GC-REG1"), { recursive: true });
    await mkdir(wt, { recursive: true });
    await writeFile(
      join(wt, ".git"),
      `gitdir: ${join(fx.repo, ".git", "worktrees", "RQ-GC-REG1")}\n`,
    );
    await writeFile(
      join(fx.runs, "RQ-GC-REG1.base"),
      `${fx.baseSha} codex-bridge/RQ-GC-REG1 ${wt} devin\n`,
    );
    await writeFile(join(fx.runs, "RQ-GC-REG1.log"), "x\ntokens used\n1\n");
    // broken pointer: gitdir does not exist
    const wt2 = join(fx.root, "RQ-GC-REG2");
    await mkdir(wt2, { recursive: true });
    await writeFile(join(wt2, ".git"), "gitdir: /nonexistent/gitdir\n");
    await writeFile(
      join(fx.runs, "RQ-GC-REG2.base"),
      `${fx.baseSha} codex-bridge/RQ-GC-REG2 ${wt2} devin\n`,
    );
    await writeFile(join(fx.runs, "RQ-GC-REG2.log"), "x\ntokens used\n1\n");
    // missing pointer entirely
    const wt3 = join(fx.root, "RQ-GC-REG3");
    await mkdir(wt3, { recursive: true });
    await writeFile(
      join(fx.runs, "RQ-GC-REG3.base"),
      `${fx.baseSha} codex-bridge/RQ-GC-REG3 ${wt3} devin\n`,
    );
    await writeFile(join(fx.runs, "RQ-GC-REG3.log"), "x\ntokens used\n1\n");
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-REG1").reasons).toContain("unregistered");
    expect(entry(report, "RQ-GC-REG2").reasons).toContain("gitdir-missing");
    expect(entry(report, "RQ-GC-REG3").reasons).toContain("git-pointer-missing");
  } finally {
    await cleanup(fx);
  }
});

test("locked and prunable worktrees preserve", async () => {
  const fx = await fixture();
  try {
    const { wt } = await seed(fx, "RQ-GC-LCK1", { publish: "RESULT EMPTY x\n" });
    must(git(fx.repo, ["worktree", "lock", wt]));
    // stale registration: worktree removed on disk but still registered
    const gone = join(fx.root, "RQ-GC-GONE");
    must(git(fx.repo, ["worktree", "add", "-b", "codex-bridge/RQ-GC-GONE", gone, fx.baseSha]));
    await rm(gone, { recursive: true, force: true });
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-LCK1").reasons).toContain("locked");
    expect(report.staleRegistrations.count).toBeGreaterThanOrEqual(1);
    expect(report.staleRegistrations.sample).toContain("RQ-GC-GONE");
  } finally {
    await cleanup(fx);
  }
});

test("lsof hold under the worktree preserves (live-process)", async () => {
  const fx = await fixture();
  try {
    const { wt } = await seed(fx, "RQ-GC-LSO1", { publish: "RESULT EMPTY x\n" });
    fx.lsofHolds = [join(wt, "somefile")];
    const report = await collect(fx);
    expect(entry(report, "RQ-GC-LSO1").reasons).toContain("live-process");
    const t = await tools(fx);
    const report2 = await collectFleetGc({
      root: fx.root,
      runs: fx.runs,
      now: at(),
      ghBin: t.ghBin,
      lsofBin: "/nonexistent/lsof",
    });
    expect(entry(report2, "RQ-GC-LSO1").reasons).toContain("lsof-unavailable");
  } finally {
    await cleanup(fx);
  }
});

test("fresh activity and idle thresholds gate candidacy", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-IDL1", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/31 x\n",
    });
    await seed(fx, "RQ-GC-IDL2", {
      publish: "RESULT PR https://github.com/ashlrai/phantom/pull/32 x\n",
    });
    const fresh = await collect(fx, { now: Date.now() });
    expect(entry(fresh, "RQ-GC-IDL1").reasons).toContain("recent-activity");
    const idle1h = await collect(fx, { now: at(3_600_000) }); // 1h: past live window, under 2h reap idle
    expect(entry(idle1h, "RQ-GC-IDL1").reasons).toContain("idle-below-threshold");
    const idle8h = await collect(fx);
    expect(entry(idle8h, "RQ-GC-IDL1").class).toBe("collect-candidate");
    expect(entry(idle8h, "RQ-GC-IDL2").class).toBe("collect-candidate");
  } finally {
    await cleanup(fx);
  }
});

test("name and record validation preserves bad entries", async () => {
  const fx = await fixture();
  try {
    await mkdir(join(fx.root, "bad name"), { recursive: true });
    await mkdir(join(fx.root, ".hidden"), { recursive: true });
    await mkdir(join(fx.root, "g1-pass"), { recursive: true });
    await seed(fx, "RQ-GC-BAD1", { base: "notasha codex-bridge/RQ-GC-BAD1 x devin\n" });
    await seed(fx, "RQ-GC-BAD2", { base: null }); // worktree but no .base
    const report = await collect(fx);
    expect(entry(report, "bad name").reasons).toContain("bad-name");
    expect(entry(report, ".hidden").reasons).toContain("bad-name");
    expect(entry(report, "g1-pass").reasons).toContain("denied-name");
    expect(entry(report, "RQ-GC-BAD1").reasons).toContain("base-invalid");
    expect(entry(report, "RQ-GC-BAD2").reasons).toContain("no-job-record");
  } finally {
    await cleanup(fx);
  }
});

test("budget exhaustion fails closed and marks scan incomplete", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-BUD1", { publish: "RESULT EMPTY x\n" });
    const report = await collect(fx, { budgetSeconds: 0 });
    const e = entry(report, "RQ-GC-BUD1");
    expect(e.class).toBe("preserve");
    expect(e.reasons).toContain("budget-exceeded");
    expect(report.scan.complete).toBe(false);
    expect(report.scan.budgetExceeded).toBe(true);
  } finally {
    await cleanup(fx);
  }
});

test("missing runs dir: everything preserves as no-job-record", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-NOR1", { publish: null, log: null, base: null });
    const t = await tools(fx);
    const report = await collectFleetGc({
      root: fx.root,
      runs: join(fx.home, "no-such-runs"),
      now: at(),
      ghBin: t.ghBin,
      lsofBin: t.lsofBin,
    });
    expect(report.sources.runs).toBe("missing");
    expect(entry(report, "RQ-GC-NOR1").reasons).toContain("no-job-record");
  } finally {
    await cleanup(fx);
  }
});

test("symlinked worktree entries are skipped, not followed", async () => {
  const fx = await fixture();
  try {
    const { wt } = await seed(fx, "RQ-GC-SYM1", { publish: "RESULT EMPTY x\n" });
    await symlink(wt, join(fx.root, "RQ-GC-SYMLINK"));
    const report = await collect(fx);
    expect(report.entries.find((e) => e.name === "RQ-GC-SYMLINK")).toBeUndefined();
    expect(report.scan.skippedNonDirs).toBeGreaterThanOrEqual(1);
    expect(entry(report, "RQ-GC-SYM1").class).toBe("collect-candidate");
  } finally {
    await cleanup(fx);
  }
});

test("repeated runs are deterministic and read-only", async () => {
  const fx = await fixture();
  try {
    await seed(fx, "RQ-GC-RPT1", { publish: "RESULT EMPTY x\n" });
    await seed(fx, "RQ-GC-RPT2", { publish: "RESULT DENIED x\n" });
    const r1 = await collect(fx);
    const r2 = await collect(fx);
    const shape = (r: FleetGcReport) =>
      r.entries.map((e) => [e.name, e.class, e.basis, e.reasons.join(",")]);
    expect(shape(r1)).toEqual(shape(r2));
    expect(entry(r1, "RQ-GC-RPT1").class).toBe("collect-candidate");
    expect(entry(r1, "RQ-GC-RPT2").class).toBe("preserve");
  } finally {
    await cleanup(fx);
  }
});
