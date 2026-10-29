import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ACTIONS_APP_ID,
  evaluateChecks,
  parseRequiredChecks,
  VERSION_RE,
} from "./auto-tag.mjs";

const SCRIPT = fileURLToPath(new URL("./auto-tag.mjs", import.meta.url));
const SHA = "a".repeat(40);
const PARENT = "b".repeat(40);

// ---------- pure-function tests ----------

describe("parseRequiredChecks", () => {
  test("unions ruleset and classic contexts, deduped and sorted", () => {
    const rules = [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "CI Gate", integration_id: 15368 }],
        },
      },
      { type: "pull_request", parameters: {} },
    ];
    const branch = {
      protection: { required_status_checks: { contexts: ["Lint"] } },
    };
    expect(parseRequiredChecks(rules, branch)).toEqual([
      { context: "CI Gate", appId: 15368 },
      { context: "Lint", appId: DEFAULT_ACTIONS_APP_ID },
    ]);
  });

  test("classic checks[] app_id is honored; pinned ruleset id wins over unpinned classic", () => {
    const rules = [
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "Merge Gate", integration_id: 42 }] },
      },
    ];
    const branch = {
      protection: {
        required_status_checks: {
          contexts: ["Merge Gate"],
          checks: [
            { context: "Lint", app_id: 99 },
            { context: "Merge Gate", app_id: null },
          ],
        },
      },
    };
    expect(parseRequiredChecks(rules, branch)).toEqual([
      { context: "Lint", appId: 99 },
      { context: "Merge Gate", appId: 42 },
    ]);
  });

  test("empty sources produce an empty list", () => {
    expect(parseRequiredChecks([], {})).toEqual([]);
    expect(parseRequiredChecks(null, null)).toEqual([]);
  });
});

describe("evaluateChecks", () => {
  const required = [
    { context: "CI Gate", appId: 15368 },
    { context: "Lint", appId: 15368 },
  ];
  const run = (name, status, conclusion, appId = 15368) => ({
    name,
    status,
    conclusion,
    appId,
  });
  const skipOk = new Set(["Lint"]);

  test("all success is green", () => {
    const res = evaluateChecks(
      required,
      [run("CI Gate", "completed", "success"), run("Lint", "completed", "success")],
      skipOk,
    );
    expect(res).toMatchObject({ pending: false, bad: false });
  });

  test("every same-named run must pass: a failed duplicate is bad even if another is green", () => {
    const res = evaluateChecks(
      required,
      [
        run("CI Gate", "completed", "success"),
        run("CI Gate", "completed", "failure"),
        run("Lint", "completed", "success"),
      ],
      skipOk,
    );
    expect(res.bad).toBe(true);
  });

  test("in_progress or queued is pending, not bad", () => {
    for (const status of ["in_progress", "queued"]) {
      const res = evaluateChecks(
        required,
        [run("CI Gate", status, ""), run("Lint", "completed", "success")],
        skipOk,
      );
      expect(res).toMatchObject({ pending: true, bad: false });
    }
  });

  test("missing required check is pending, never bad", () => {
    const res = evaluateChecks(required, [run("Lint", "completed", "success")], skipOk);
    expect(res).toMatchObject({ pending: true, bad: false });
    expect(res.lines[0]).toContain("missing: CI Gate");
  });

  test("skipped is bad unless the check is SKIP_OK", () => {
    const runs = [run("CI Gate", "completed", "skipped"), run("Lint", "completed", "skipped")];
    expect(evaluateChecks(required, runs, skipOk).bad).toBe(true);
    expect(evaluateChecks(required, runs, new Set(["CI Gate", "Lint"])).bad).toBe(false);
  });

  test("neutral is not green", () => {
    const res = evaluateChecks(
      required,
      [run("CI Gate", "completed", "neutral"), run("Lint", "completed", "success")],
      skipOk,
    );
    expect(res.bad).toBe(true);
  });

  test("a same-named run from another app does not satisfy the check", () => {
    const res = evaluateChecks(
      required,
      [run("CI Gate", "completed", "success", 9999), run("Lint", "completed", "success")],
      skipOk,
    );
    expect(res.pending).toBe(true);
  });

  test("a check pinned to a non-Actions app accepts runs from that app", () => {
    const res = evaluateChecks(
      [{ context: "Merge Gate", appId: 42 }],
      [run("Merge Gate", "completed", "success", 42)],
      new Set(),
    );
    expect(res).toMatchObject({ pending: false, bad: false });
  });
});

describe("VERSION_RE", () => {
  test("accepts strict semver, rejects anything looser", () => {
    expect(VERSION_RE.test("0.2.2")).toBe(true);
    for (const v of ["v0.2.2", "0.2", "0.2.2-rc", "latest", "1.2.3.4", ""]) {
      expect(VERSION_RE.test(v)).toBe(false);
    }
  });
});

// ---------- end-to-end through a stub gh ----------

// The stub answers `gh api ...`/`gh workflow run ...` from a routes file and
// appends every invocation to a log. A route's responses are consumed in order
// (the last one repeats), which lets tests script poll sequences.
const GH_STUB = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const endpoint = args.find((a) => a.startsWith("repos/")) ?? args.join(" ");
const routesFile = process.env.GH_STUB_ROUTES;
const routes = JSON.parse(readFileSync(routesFile, "utf8"));
if (process.env.GH_STUB_LOG) appendFileSync(process.env.GH_STUB_LOG, endpoint + "\\n");
for (const r of routes) {
  if (!endpoint.includes(r.match)) continue;
  if (r.reject && endpoint.includes(r.reject)) continue;
  let resp = r.responses[0];
  if (r.responses.length > 1) {
    resp = r.responses.shift();
    writeFileSync(routesFile, JSON.stringify(routes));
  }
  if (resp.stdout) process.stdout.write(resp.stdout);
  if (resp.stderr) process.stderr.write(resp.stderr);
  process.exit(resp.status ?? 0);
}
process.stderr.write("no route for: " + endpoint + "\\n");
process.exit(2);
`;

const pkg = (version) => ({ status: 0, stdout: JSON.stringify({ name: "x", version }) });
const json = (body) => ({ status: 0, stdout: JSON.stringify(body) });
const runsPage = (check_runs) => json([{ total_count: check_runs.length, check_runs }]);
const checkRun = (name, status, conclusion) => ({
  name,
  status,
  conclusion,
  app: { id: 15368 },
});

function fixture(routes) {
  const dir = mkdtempSync(join(tmpdir(), "auto-tag-"));
  const stubJs = join(dir, "gh-stub.mjs");
  const ghBin = join(dir, "gh");
  const routesFile = join(dir, "routes.json");
  const log = join(dir, "calls.log");
  const output = join(dir, "github-output");
  writeFileSync(stubJs, GH_STUB);
  // Plain node: the script's production runtime, and ~40x faster to spawn than
  // bun under a test HOME, which keeps e2e tests well inside their timeout.
  writeFileSync(ghBin, `#!/bin/sh\nexec node "${stubJs}" "$@"\n`);
  chmodSync(ghBin, 0o755);
  writeFileSync(routesFile, JSON.stringify(routes));
  return { dir, ghBin, routesFile, log, output };
}

function runCli(fx, args, env = {}) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GH_BIN: fx.ghBin,
      GH_TOKEN: "test-token",
      GH_STUB_ROUTES: fx.routesFile,
      GH_STUB_LOG: fx.log,
      REPO: "o/r",
      SHA,
      BRANCH: "main",
      VERSION_FILE: "packages/cli/package.json",
      AUTO_TAG_DELAYS: "0 0",
      GITHUB_OUTPUT: fx.output,
      ...env,
    },
  });
}

const versionRoutes = (current, previous) => [
  {
    match: `commits/${SHA}`,
    reject: "/check-runs",
    responses: [json({ parents: [{ sha: PARENT }] })],
  },
  {
    match: `contents/packages/cli/package.json?ref=${SHA}`,
    responses: [pkg(current)],
  },
  {
    match: `contents/packages/cli/package.json?ref=${PARENT}`,
    responses: [pkg(previous)],
  },
];

const REQUIRED_ROUTES = [
  {
    match: "rules/branches",
    responses: [
      json([
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "CI Gate", integration_id: 15368 }],
          },
        },
      ]),
    ],
  },
  {
    match: "repos/o/r/branches/main",
    responses: [
      json({ protection: { required_status_checks: { contexts: ["Lint"] } } }),
    ],
  },
];

const calls = (fx) =>
  existsSync(fx.log) ? readFileSync(fx.log, "utf8").trim().split("\n") : [];
const outputs = (fx) => readFileSync(fx.output, "utf8");

// spawnSync under `bun test` carries ~1-2s fixed overhead per process; give
// every e2e case a wide timeout so slow CI stays green.
const T = 30000;

describe("auto-tag e2e", () => {
  test("version unchanged exits 0 without consulting checks", () => {
    const fx = fixture([...versionRoutes("0.2.2", "0.2.2")]);
    const r = runCli(fx, ["evaluate"], { TRIGGER: "push" });
    expect(r.status).toBe(0);
    expect(outputs(fx)).toBe("changed=false\n");
    expect(calls(fx).some((c) => c.includes("check-runs"))).toBe(false);
  }, T);

  test("bump + green required checks + absent tag -> green=true, then create posts the ref", () => {
    const fx = fixture([
      ...versionRoutes("0.2.3", "0.2.2"),
      { match: "git/matching-refs/tags/", responses: [json([])] },
      ...REQUIRED_ROUTES,
      {
        match: "check-runs",
        responses: [
          runsPage([
            checkRun("CI Gate", "completed", "success"),
            checkRun("Lint", "completed", "skipped"),
          ]),
        ],
      },
      { match: "git/refs", responses: [json({ ref: "refs/tags/v0.2.3" })] },
    ]);
    const r = runCli(fx, ["evaluate"], { TRIGGER: "push", SKIP_OK: "Lint" });
    expect(r.status).toBe(0);
    for (const line of ["changed=true", "version=0.2.3", "green=true"]) {
      expect(outputs(fx)).toContain(`${line}\n`);
    }

    const c = runCli(fx, ["create", "--version", "0.2.3"]);
    expect(c.status).toBe(0);
    expect(calls(fx).some((l) => l === "repos/o/r/git/refs")).toBe(true);
  }, T);

  test("run evaluates and creates in one go", () => {
    const fx = fixture([
      ...versionRoutes("0.2.3", "0.2.2"),
      { match: "git/matching-refs/tags/", responses: [json([])] },
      ...REQUIRED_ROUTES,
      {
        match: "check-runs",
        responses: [runsPage([checkRun("CI Gate", "completed", "success"), checkRun("Lint", "completed", "success")])],
      },
      { match: "git/refs", responses: [json({ ref: "refs/tags/v0.2.3" })] },
    ]);
    const r = runCli(fx, ["run"], { TRIGGER: "manual", SKIP_OK: "Lint" });
    expect(r.status).toBe(0);
    expect(calls(fx).some((l) => l === "repos/o/r/git/refs")).toBe(true);
  }, T);

  test("existing tag short-circuits before check evaluation", () => {
    const fx = fixture([
      ...versionRoutes("0.2.3", "0.2.2"),
      { match: "git/matching-refs/tags/", responses: [json([{ ref: "refs/tags/v0.2.3" }])] },
    ]);
    const r = runCli(fx, ["evaluate"], { TRIGGER: "push" });
    expect(r.status).toBe(0);
    expect(outputs(fx)).toBe("changed=false\n");
    expect(calls(fx).some((c) => c.includes("check-runs"))).toBe(false);
  }, T);

  test("a failed required check fails closed at once", () => {
    const fx = fixture([
      ...versionRoutes("0.2.3", "0.2.2"),
      { match: "git/matching-refs/tags/", responses: [json([])] },
      ...REQUIRED_ROUTES,
      {
        match: "check-runs",
        responses: [
          runsPage([checkRun("CI Gate", "completed", "failure"), checkRun("Lint", "completed", "success")]),
        ],
      },
    ]);
    const r = runCli(fx, ["evaluate"], { TRIGGER: "push", SKIP_OK: "Lint" });
    expect(r.status).toBe(1);
    expect(outputs(fx)).not.toContain("green=");
  }, T);

  test("pending then green across polls exits 0 green=true", () => {
    const fx = fixture([
      ...versionRoutes("0.2.3", "0.2.2"),
      { match: "git/matching-refs/tags/", responses: [json([])] },
      ...REQUIRED_ROUTES,
      {
        match: "check-runs",
        responses: [
          runsPage([checkRun("CI Gate", "in_progress", ""), checkRun("Lint", "completed", "success")]),
          runsPage([checkRun("CI Gate", "completed", "success"), checkRun("Lint", "completed", "success")]),
        ],
      },
    ]);
    const r = runCli(fx, ["evaluate"], { TRIGGER: "workflow_run", SKIP_OK: "Lint" });
    expect(r.status).toBe(0);
    expect(outputs(fx)).toContain("green=true");
    expect(calls(fx).filter((c) => c.includes("check-runs")).length).toBe(2);
  }, T);

  test("still pending: push trigger ends green=false, workflow_run fails", () => {
    const mk = () =>
      fixture([
        ...versionRoutes("0.2.3", "0.2.2"),
        { match: "git/matching-refs/tags/", responses: [json([])] },
        ...REQUIRED_ROUTES,
        {
          match: "check-runs",
          responses: [runsPage([checkRun("CI Gate", "in_progress", "")])],
        },
      ]);
    const push = runCli(mk(), ["evaluate"], { TRIGGER: "push", SKIP_OK: "Lint" });
    expect(push.status).toBe(0);
    const wr = runCli(mk(), ["evaluate"], { TRIGGER: "workflow_run", SKIP_OK: "Lint" });
    expect(wr.status).toBe(1);
    expect(wr.stderr).toContain("refusing to tag");
  }, T);

  test("no required checks discovered fails closed", () => {
    const fx = fixture([
      ...versionRoutes("0.2.3", "0.2.2"),
      { match: "git/matching-refs/tags/", responses: [json([])] },
      { match: "rules/branches", responses: [json([])] },
      { match: "repos/o/r/branches/main", responses: [json({ protection: {} })] },
    ]);
    const r = runCli(fx, ["evaluate"], { TRIGGER: "push" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no required checks");
  }, T);

  test("non-semver version fails closed", () => {
    const fx = fixture([
      {
        match: `commits/${SHA}`,
        responses: [json({ parents: [{ sha: PARENT }] })],
      },
      {
        match: `contents/packages/cli/package.json?ref=${SHA}`,
        responses: [pkg("v0.2.3")],
      },
      {
        match: `contents/packages/cli/package.json?ref=${PARENT}`,
        responses: [pkg("0.2.2")],
      },
    ]);
    const r = runCli(fx, ["evaluate"], { TRIGGER: "push" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unexpected version");
  }, T);

  test("create is idempotent: existing tag and already-exists POST both exit 0", () => {
    const exists = fixture([
      { match: "git/matching-refs/tags/", responses: [json([{ ref: "refs/tags/v0.2.3" }])] },
    ]);
    expect(runCli(exists, ["create", "--version", "0.2.3"]).status).toBe(0);
    expect(calls(exists).some((l) => l === "repos/o/r/git/refs")).toBe(false);

    const race = fixture([
      { match: "git/matching-refs/tags/", responses: [json([])] },
      {
        match: "git/refs",
        responses: [{ status: 1, stderr: "Reference already exists" }],
      },
    ]);
    expect(runCli(race, ["create", "--version", "0.2.3"]).status).toBe(0);
  }, T);

  test("create refuses a non-semver version before any API call", () => {
    const fx = fixture([]);
    const r = runCli(fx, ["create", "--version", "next"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unexpected version");
    expect(calls(fx)).toEqual([]);
  }, T);

  test("--dispatch triggers the release workflow with the tag input", () => {
    const fx = fixture([
      { match: "git/matching-refs/tags/", responses: [json([])] },
      { match: "git/refs", responses: [json({ ref: "refs/tags/v0.2.3" })] },
      { match: "workflow run release.yml", responses: [{ status: 0 }] },
    ]);
    const r = runCli(fx, ["create", "--version", "0.2.3", "--dispatch"]);
    expect(r.status).toBe(0);
    expect(calls(fx).some((l) => l.includes("workflow run release.yml") && l.includes("tag=v0.2.3"))).toBe(
      true,
    );
  }, T);
});
