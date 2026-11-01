#!/usr/bin/env node
// scripts/auto-tag.mjs — create tag v<version> when the version in the CLI
// package manifest changes on the default branch and every required check for
// that exact commit is green.
//
// This is the testable core of the auto-tag workflow reworked from PR #124
// (which conflicted on .github/workflows/release.yml). The workflow itself
// lives under .github/ and is a thin wrapper: it runs `evaluate` with the
// default read-only token, mints the ashlr-release App token only when the
// outputs say green, then runs `create` with that token. Tags are created
// only here, so the tag-triggered release workflow (release.yml on.push.tags)
// runs. release-please, if present, only opens version PRs and never tags.
//
// Required checks are discovered at run time from the branch rules API
// (rulesets) unioned with classic branch protection contexts. Fail closed:
//  - no required checks discovered -> fail
//  - a check run counts only when posted by the app the check is pinned to
//    (ruleset integration_id, or classic protection app_id; unpinned checks
//    default to GitHub Actions, app id 15368). EVERY latest run with a
//    required name must be completed + success. Commit statuses never count.
//  - a required check missing, queued or in progress -> bounded wait
//    (~9.5 min), then no tag: a notice on the push trigger (a workflow_run
//    trigger re-evaluates after CI), a failure otherwise
//  - any conclusion other than success -> fail at once. skipped and neutral
//    are NOT green: required checks here use the skip-job pattern (phantom
//    #811) which reports success, so a skipped required check means it did
//    not run. Only names listed in SKIP_OK may report skipped (PR-only jobs).
//
// Usage:
//   node scripts/auto-tag.mjs evaluate                 read-only evaluation;
//                                                       appends changed/version/
//                                                       green to $GITHUB_OUTPUT
//   node scripts/auto-tag.mjs create --version X.Y.Z   create refs/tags/vX.Y.Z
//                                                       at SHA (needs a token
//                                                       with contents: write)
//   node scripts/auto-tag.mjs run                      evaluate, then create
//                                                       when green
//
// Env:
//   GH_TOKEN         token `gh api` uses; also accepts GITHUB_TOKEN or an
//                    existing `gh auth` session (evaluate needs only read)
//   REPO             owner/name (default: GITHUB_REPOSITORY or `gh repo view`)
//   SHA              commit evaluated and tagged (default: GITHUB_SHA or HEAD)
//   BRANCH           default branch rules are read for (main)
//   VERSION_FILE     manifest whose .version triggers a tag
//                    (packages/cli/package.json)
//   TRIGGER          push | workflow_run | manual; only on push does a
//                    still-pending wait end green=false instead of failing
//   SKIP_OK          check names allowed to report `skipped`, space or comma
//                    separated ("Lint"; Lint is PR-only by design)
//   ACTIONS_APP_ID   app id treated as GitHub Actions (15368)
//   AUTO_TAG_DELAYS  bounded-wait schedule in seconds
//                    ("0 20 40 60 90 120 120 120" ~= 9.5 min)
//   DISPATCH         "1" also dispatches release.yml with inputs.tag after
//                    creating the tag; default off because an App-token tag
//                    push already triggers on.push.tags (a dispatch would
//                    queue a second run of the same concurrency group)
//   RELEASE_WORKFLOW workflow file dispatched when DISPATCH=1 (release.yml)
//   GH_BIN           gh executable (tests point it at a stub)
//   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY   honored when set

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const VERSION_RE = /^\d+\.\d+\.\d+$/;
export const DEFAULT_DELAYS = "0 20 40 60 90 120 120 120";
export const DEFAULT_ACTIONS_APP_ID = 15368;

const sleepSync = (seconds) => {
  if (seconds <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
  } catch {
    spawnSync("sleep", [String(seconds)]);
  }
};

export function gh(cfg, args) {
  const r = spawnSync(cfg.ghBin, args, { encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
}

function ghJson(cfg, args) {
  const r = gh(cfg, args);
  if (r.status !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${(r.stderr || r.stdout).trim()}`);
  }
  return JSON.parse(r.stdout);
}

// Raw-content accept returns the manifest body itself, so this doubles as the
// "no checkout" read the workflow spec requires.
export function readVersion(cfg, ref) {
  const body = ghJson(cfg, [
    "api",
    "-H",
    "Accept: application/vnd.github.raw",
    `repos/${cfg.repo}/contents/${cfg.versionFile}?ref=${ref}`,
  ]);
  return body?.version ?? null;
}

export function firstParent(cfg, sha) {
  const commit = ghJson(cfg, ["api", `repos/${cfg.repo}/commits/${sha}`]);
  return commit?.parents?.[0]?.sha ?? null;
}

// Lists tag refs once and exact-matches: unambiguous (no 404 parsing) and the
// same call serves the pre-create re-check.
export function tagExists(cfg, version) {
  const refs = ghJson(cfg, ["api", "--paginate", "--slurp", `repos/${cfg.repo}/git/matching-refs/tags/`]);
  return (refs ?? []).flat().some((r) => r.ref === `refs/tags/v${version}`);
}

// Union ruleset required_status_checks with classic branch protection, keyed
// by context. A pinned integration_id/app_id always wins over an unpinned
// entry; unpinned contexts fall back to GitHub Actions (app 15368), matching
// the reviewed workflow: a same-named run from any other app never counts.
export function parseRequiredChecks(rules, branch, defaultAppId = DEFAULT_ACTIONS_APP_ID) {
  const byContext = new Map();
  const put = (context, appId) => {
    if (!context) return;
    const prev = byContext.get(context);
    if (prev === undefined || (prev === null && appId != null)) {
      byContext.set(context, appId ?? null);
    }
  };
  for (const rule of rules ?? []) {
    if (rule?.type !== "required_status_checks") continue;
    for (const c of rule.parameters?.required_status_checks ?? []) {
      put(c.context, c.integration_id ?? null);
    }
  }
  const rsc = branch?.protection?.required_status_checks;
  for (const ctx of rsc?.contexts ?? []) put(ctx, null);
  for (const c of rsc?.checks ?? []) put(c.context, c.app_id ?? null);
  return [...byContext]
    .map(([context, appId]) => ({ context, appId: appId ?? defaultAppId }))
    .sort((a, b) => a.context.localeCompare(b.context));
}

// --paginate --slurp yields one array of page objects; the server-side app_id
// filter is then double-checked per run, as in the reviewed workflow.
export function latestRuns(cfg, appId) {
  const pages = ghJson(cfg, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${cfg.repo}/commits/${cfg.sha}/check-runs?filter=latest&app_id=${appId}&per_page=100`,
  ]);
  return (pages ?? [])
    .flatMap((p) => p.check_runs ?? [])
    .filter((r) => r.app?.id === appId)
    .map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion ?? "", appId }));
}

// Every latest run carrying a required name is judged: any unfinished -> pending,
// any non-success conclusion -> bad (skipped tolerable only for SKIP_OK names).
export function evaluateChecks(required, runs, skipOk = new Set()) {
  let pending = false;
  let bad = false;
  const lines = [];
  for (const req of required) {
    const rows = runs.filter((r) => r.name === req.context && r.appId === req.appId);
    if (rows.length === 0) {
      lines.push(
        `missing: ${req.context} (no check run from app ${req.appId}; commit statuses never satisfy a required check)`,
      );
      pending = true;
      continue;
    }
    for (const row of rows) {
      if (row.status !== "completed") {
        lines.push(`pending: ${req.context} (${row.status})`);
        pending = true;
      } else if (row.conclusion === "success") {
        lines.push(`green: ${req.context}`);
      } else if (row.conclusion === "skipped" && skipOk.has(req.context)) {
        lines.push(`skipped by design on push: ${req.context}`);
      } else {
        lines.push(`::error::not green: ${req.context} (${row.conclusion || "no conclusion"})`);
        bad = true;
      }
    }
  }
  return { pending, bad, lines };
}

function tryReadVersion(cfg, ref) {
  try {
    return readVersion(cfg, ref);
  } catch {
    return null;
  }
}

export function detectVersionChange(cfg) {
  const parent = firstParent(cfg, cfg.sha);
  const current = readVersion(cfg, cfg.sha);
  if (!VERSION_RE.test(current ?? "")) {
    throw new Error(`unexpected version '${current}' in ${cfg.versionFile}@${cfg.sha}`);
  }
  const previous = parent ? tryReadVersion(cfg, parent) : null;
  return { version: current, previous: previous ?? "none", changed: previous !== current };
}

// Full read-only pass: version bump -> tag already exists -> required checks
// green. Throws (exit 1) on hard failures; returns green=false without throwing
// only for the push trigger's still-pending case.
export function evaluate(cfg, emit = console.log) {
  const out = (k, v) => {
    if (cfg.githubOutput) appendFileSync(cfg.githubOutput, `${k}=${v}\n`);
  };

  const det = detectVersionChange(cfg);
  if (!det.changed) {
    emit(`Version unchanged (${det.version}); nothing to tag.`);
    out("changed", "false");
    return { changed: false, version: det.version, green: false };
  }
  if (tagExists(cfg, det.version)) {
    emit(`Tag v${det.version} already exists; nothing to do.`);
    out("changed", "false");
    return { changed: false, version: det.version, green: false };
  }
  out("version", det.version);
  out("changed", "true");

  const rules = ghJson(cfg, ["api", `repos/${cfg.repo}/rules/branches/${cfg.branch}`]);
  const branch = ghJson(cfg, ["api", `repos/${cfg.repo}/branches/${cfg.branch}`]);
  const required = parseRequiredChecks(rules, branch, cfg.actionsAppId);
  if (required.length === 0) {
    throw new Error(`no required checks discovered for ${cfg.branch}; refusing to tag`);
  }
  const skipOk = new Set(cfg.skipOk);
  const appIds = [...new Set(required.map((r) => r.appId))];

  for (const delay of cfg.delays) {
    sleepSync(delay);
    const runs = appIds.flatMap((id) => latestRuns(cfg, id));
    const res = evaluateChecks(required, runs, skipOk);
    for (const line of res.lines) emit(line);
    if (res.bad) throw new Error("a required check is not green; refusing to tag");
    if (!res.pending) {
      out("green", "true");
      return { changed: true, version: det.version, green: true };
    }
  }
  if (cfg.trigger === "push") {
    emit("::notice::required checks still not finished; the workflow_run trigger re-evaluates after CI");
    out("green", "false");
    return { changed: true, version: det.version, green: false };
  }
  throw new Error("required checks missing or pending after the bounded wait; refusing to tag");
}

export function createTag(cfg, version, emit = console.log) {
  if (!VERSION_RE.test(version ?? "")) {
    throw new Error(`refusing to tag unexpected version '${version}'`);
  }
  if (tagExists(cfg, version)) {
    emit(`Tag v${version} exists; nothing to do.`);
    return { created: false, version };
  }
  const r = gh(cfg, [
    "api",
    "-X",
    "POST",
    `repos/${cfg.repo}/git/refs`,
    "-f",
    `ref=refs/tags/v${version}`,
    "-f",
    `sha=${cfg.sha}`,
  ]);
  if (r.status !== 0) {
    const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
    if (/already exists/i.test(text)) {
      emit(`Tag v${version} appeared meanwhile; nothing to do.`);
      return { created: false, version };
    }
    throw new Error(`creating refs/tags/v${version} failed: ${text}`);
  }
  emit(`Created v${version} at ${cfg.sha}`);
  if (cfg.githubStepSummary) appendFileSync(cfg.githubStepSummary, `Created v${version} at ${cfg.sha}\n`);
  if (cfg.dispatch) dispatchRelease(cfg, version);
  return { created: true, version };
}

function dispatchRelease(cfg, version) {
  const r = gh(cfg, [
    "workflow",
    "run",
    cfg.releaseWorkflow,
    "--repo",
    cfg.repo,
    "--ref",
    cfg.branch,
    "-f",
    `tag=v${version}`,
  ]);
  if (r.status !== 0) {
    throw new Error(`dispatching ${cfg.releaseWorkflow} failed: ${(r.stderr || r.stdout).trim()}`);
  }
}

function detectRepo(ghBin) {
  const r = spawnSync(ghBin, ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    encoding: "utf8",
  });
  const repo = (r.stdout || "").trim();
  if (r.status !== 0 || !repo) throw new Error("set REPO=owner/name (not in a repo and GITHUB_REPOSITORY unset)");
  return repo;
}

function detectSha() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const sha = (r.stdout || "").trim();
  if (r.status !== 0 || !sha) throw new Error("set SHA (not in a git worktree and GITHUB_SHA unset)");
  return sha;
}

function ensureAuth(ghBin, env) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return;
  const r = spawnSync(ghBin, ["auth", "status"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error("no GH_TOKEN/GITHUB_TOKEN and `gh auth status` failed; evaluate needs read, create needs contents:write");
  }
}

export function buildConfig(env = process.env) {
  const ghBin = env.GH_BIN || "gh";
  const cfg = {
    ghBin,
    repo: env.REPO || env.GITHUB_REPOSITORY || detectRepo(ghBin),
    sha: env.SHA || env.GITHUB_SHA || detectSha(),
    branch: env.BRANCH || "main",
    versionFile: env.VERSION_FILE || "packages/cli/package.json",
    trigger: env.TRIGGER || "manual",
    skipOk: (env.SKIP_OK ?? "Lint").split(/[,\s]+/).filter(Boolean),
    actionsAppId: Number(env.ACTIONS_APP_ID || DEFAULT_ACTIONS_APP_ID),
    delays: (env.AUTO_TAG_DELAYS || DEFAULT_DELAYS)
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number),
    dispatch: env.DISPATCH === "1",
    releaseWorkflow: env.RELEASE_WORKFLOW || "release.yml",
    githubOutput: env.GITHUB_OUTPUT || null,
    githubStepSummary: env.GITHUB_STEP_SUMMARY || null,
  };
  if (cfg.delays.length === 0 || cfg.delays.some((d) => !Number.isFinite(d) || d < 0)) {
    throw new Error(`bad AUTO_TAG_DELAYS '${env.AUTO_TAG_DELAYS}'`);
  }
  if (!Number.isInteger(cfg.actionsAppId) || cfg.actionsAppId <= 0) {
    throw new Error(`bad ACTIONS_APP_ID '${env.ACTIONS_APP_ID}'`);
  }
  ensureAuth(ghBin, env);
  return cfg;
}

function parseFlags(args) {
  const flags = { dispatch: false, help: false, version: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--version" || a === "-v") flags.version = args[++i];
    else if (a.startsWith("--version=")) flags.version = a.slice("--version=".length);
    else if (a === "--dispatch") flags.dispatch = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else throw new Error(`unknown argument '${a}'`);
  }
  return flags;
}

const USAGE = `Usage:
  node scripts/auto-tag.mjs evaluate               read-only; writes GITHUB_OUTPUT keys
  node scripts/auto-tag.mjs create --version X.Y.Z create refs/tags/vX.Y.Z at SHA
  node scripts/auto-tag.mjs run                    evaluate, then create when green
Options: --dispatch (also dispatch the release workflow), --help`;

export function main(argv, env = process.env) {
  // First non-flag arg is the subcommand; everything else goes to parseFlags.
  // Flag/usage handling stays ahead of buildConfig so --help and bad usage
  // never touch auth detection or the network.
  let cmd = null;
  const rest = [];
  for (const a of argv) {
    if (cmd === null && !a.startsWith("-")) cmd = a;
    else rest.push(a);
  }
  const flags = parseFlags(rest);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!cmd || !["evaluate", "create", "run"].includes(cmd)) {
    console.log(USAGE);
    return 1;
  }
  const cfg = buildConfig(env);
  if (flags.dispatch) cfg.dispatch = true;
  if (cmd === "evaluate") {
    const res = evaluate(cfg);
    return res.green || !res.changed || cfg.trigger === "push" ? 0 : 1;
  }
  if (cmd === "create") {
    if (!flags.version) throw new Error("create requires --version X.Y.Z");
    createTag(cfg, flags.version);
    return 0;
  }
  if (cmd === "run") {
    const res = evaluate(cfg);
    if (res.changed && res.green) createTag(cfg, res.version);
    return res.green || !res.changed || cfg.trigger === "push" ? 0 : 1;
  }
  console.log(USAGE);
  return 1;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
