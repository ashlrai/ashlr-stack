import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type FleetSourceStatus,
  isFleetRow,
  openFleetFile,
  readFleetJson,
  readFleetText,
} from "./fleet-jsonl.ts";

const execFileAsync = promisify(execFile);

/**
 * fleet-gc collector — read-only dry-run classification of dispatcher worktrees.
 *
 * Mirrors the safety boundary of the on-host reapers (dispatchd.py reap loop,
 * reap-one.sh, reap-merged.sh --empty): a worktree is a collect-candidate only
 * with positive evidence — a verified RESULT line plus merged/closed PR state,
 * or a done-status (RESULT EMPTY / DONE-NOOP / inferred DONE-EMPTY) plus a
 * clean-at-base tree — and never while any liveness, claim, keep or hold signal
 * is present. Anything unknown, unreadable or contradictory preserves.
 *
 * Nothing here mutates: no deletes, no git writes, no fetches, no prunes. Actual
 * collection stays with the dispatcher's lock-aware reapers; see
 * docs/worktree-gc-proposal.md.
 */

/** Job ids in the dispatcher's accepted shape (reap-merged bad_name rejects leading dots). */
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** reap-merged LIVE_S: log/base fresher than this means a launch may be in flight. */
const LIVE_WINDOW_MS = 900_000;
/** reap-merged CLAUDE_PUSH_S: claude/* RESULT PR worktrees need a publish this old. */
const CLAUDE_PUSH_MS = 1_800_000;
/** reap-merged LOG_TAIL: end-marker scan window at the end of the job log. */
const LOG_TAIL = 8192;
/** reap-merged REAP_MAX_GH default: cap on `gh pr view` calls per scan. */
const GH_MAX_DEFAULT = 40;

/** Repos the hold list may name (reap-merged.sh REPOS). */
const FLEET_REPOS = new Set([
  "phantom",
  "phantom-secrets",
  "ashlr-plugin",
  "locus",
  "lexicon",
  "ashlr-md",
  "ashlr-stack",
]);

/** Ignored-path allowance copied from reap-merged.sh BUILD_ALLOW. */
const BUILD_ALLOW = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".vite",
  "out",
  ".cache",
]);

/** Branch prefixes reap-merged.sh refuses in --empty mode (codex/*|claude/*). */
const PROTECTED_EMPTY = /^(?:codex|claude)\//;
/** Branch prefixes refused in merged mode (codex/* only; claude/* needs push age). */
const PROTECTED_PR = /^codex\//;
const CLAUDE_BRANCH = /^claude\//;

/**
 * Direct-child names reap-merged contained() would deny even with a valid job-id
 * shape: its denied-name patterns reduce to these under the worktree root.
 */
const DENIED_NAME = /vault|keychains/i;
const DENIED_NAMES = new Set(["g1-pass", "quarantine", ".codex", ".codex-2", ".ashlr-runs"]);

/** Directories never descended during the idle-mtime walk (.git anywhere, build output at top level). */
const WALK_PRUNE_ANYWHERE = new Set([".git", "node_modules"]);
const WALK_PRUNE_TOP = new Set([...BUILD_ALLOW].filter((d) => d !== "node_modules"));
const WALK_MAX_ENTRIES = 60_000;

/** Strict RESULT PR line, same shape reap-merged.sh result_ok accepts. */
const RESULT_PR_RE =
  /^RESULT PR https:\/\/github\.com\/ashlrai\/([A-Za-z0-9._-]+)\/pull\/([0-9]{1,7})(?: |$)/;

const ENV_ALLOW = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_CONFIG_DIR",
] as const;

interface ProcResult {
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOW) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.PATH ??= "/usr/bin:/bin:/usr/sbin:/sbin";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  return { ...env, ...extra };
}

async function runProc(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxBuffer: number,
): Promise<ProcResult> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      env: cleanEnv(),
      timeout: timeoutMs,
      maxBuffer,
    });
    return { code: 0, stdout, timedOut: false };
  } catch (error) {
    const e = error as { stdout?: unknown; code?: unknown; killed?: unknown };
    return {
      code: typeof e.code === "number" ? e.code : null,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      timedOut: e.killed === true,
    };
  }
}

const runGit = (args: string[], cwd: string, timeoutMs = 15_000) =>
  runProc("git", args, cwd, timeoutMs, 8 * 1024 * 1024);

interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Parse `git worktree list --porcelain -z`: NUL-terminated attributes, "" separates entries. */
export function parseWorktreePorcelain(text: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = [];
  let cur: WorktreeInfo | null = null;
  for (const rec of text.split("\0")) {
    if (rec.startsWith("worktree ")) {
      if (cur) out.push(cur);
      cur = {
        path: rec.slice("worktree ".length),
        head: "",
        branch: null,
        detached: false,
        locked: false,
        prunable: false,
      };
    } else if (cur) {
      if (rec.startsWith("HEAD ")) cur.head = rec.slice(5);
      else if (rec.startsWith("branch ")) cur.branch = rec.slice(7);
      else if (rec === "detached") cur.detached = true;
      else if (rec === "locked" || rec.startsWith("locked ")) cur.locked = true;
      else if (rec === "prunable" || rec.startsWith("prunable ")) cur.prunable = true;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export type GcClass = "preserve" | "collect-candidate";
/** Evidence basis: verified PR result, verified EMPTY result, DONE-NOOP, or inferred EMPTY. */
export type GcBasis = "result-pr" | "result-empty" | "done-noop" | "empty-inferred";
export type ResultClass = "pr" | "empty" | "archived" | "denied" | "abort" | "other" | "none";

export interface GcEntry {
  name: string;
  path: string;
  class: GcClass;
  /** Preserve reasons (candidates have none). */
  reasons: string[];
  basis?: GcBasis;
  resultClass?: Exclude<ResultClass, "none">;
  jobState?: string;
  idleHours?: number | null;
  repo?: string;
  head?: string;
  branch?: string | null;
  detached?: boolean;
  pr?: string;
}

export interface FleetGcOptions {
  root: string;
  runs: string;
  queue?: string;
  /** Idle hours before RESULT PR worktrees are candidates (default 2, REAP_IDLE_H). */
  reapIdleHours?: number;
  /** Idle hours before done/empty worktrees are candidates (default 6, EMPTY_AGE_S). */
  emptyIdleHours?: number;
  /** Wall-clock seconds allowed for deep (git + tree-walk + gh) inspection (default 120). */
  budgetSeconds?: number;
  /** gh binary override (tests); default: first of the usual install paths, then PATH. */
  ghBin?: string;
  /** lsof binary override (tests); default: /usr/sbin/lsof then /usr/bin/lsof. */
  lsofBin?: string;
  /** Cap on `gh pr view` calls (default 40, REAP_MAX_GH). */
  ghMax?: number;
  now?: number;
}

interface FleetState {
  keep: Set<string>;
  landonly: Set<string>;
  queued: Set<string>;
  statusKept: Set<string>;
  statusReaping: Set<string>;
  g1pass: Set<string>;
  precheckDone: Set<string>;
  holdEntries: { repo: string; prs: Set<string> }[];
  holdListOk: boolean;
  sources: Record<string, FleetSourceStatus>;
}

const tokenSet = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

/** Last RESULT line classification, mirroring reap-one.sh case order. */
function lastResultClass(text: string): { cls: Exclude<ResultClass, "none"> | null; line: string } {
  const lines = text.split("\n").filter((l) => l.startsWith("RESULT"));
  const line = lines.at(-1) ?? "";
  if (!line) return { cls: null, line: "" };
  if (line.startsWith("RESULT PR ")) {
    // Only a well-formed PR URL counts as pr; anything else stays supervisor-kept.
    return RESULT_PR_RE.test(line) ? { cls: "pr", line } : { cls: "other", line };
  }
  if (line.startsWith("RESULT ARCHIVED ")) return { cls: "archived", line };
  if (line === "RESULT EMPTY" || line.startsWith("RESULT EMPTY ")) return { cls: "empty", line };
  if (line.includes("secret-shape")) return { cls: "abort", line };
  if (line.startsWith("RESULT DENIED")) return { cls: "denied", line };
  if (line.startsWith("RESULT ABORT ")) return { cls: "abort", line };
  return { cls: "other", line };
}

const sha256Hex = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/** Bounded regular-file read returning raw bytes (for the rules sha256 pin). */
async function readFleetBytes(path: string, maxBytes = 1024 * 1024) {
  try {
    const file = await openFleetFile(path);
    try {
      const stat = await file.stat();
      if (stat.size > maxBytes) return { status: "invalid" as const, bytes: null };
      const buf = Buffer.alloc(stat.size);
      const { bytesRead } = await file.read(buf, 0, stat.size, 0);
      return { status: "ok" as const, bytes: buf.subarray(0, bytesRead) };
    } finally {
      await file.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      status: (code === "ENOENT" ? "missing" : "invalid") as FleetSourceStatus,
      bytes: null,
    };
  }
}

/**
 * Hold list (reap-merged K1): ENGINEER-RULES.md must be a pinned, sha-verified
 * regular file with exactly one "7. Hold list" line; any deviation fails closed.
 */
async function loadHoldList(
  runs: string,
  sources: Record<string, FleetSourceStatus>,
): Promise<{ entries: { repo: string; prs: Set<string> }[]; ok: boolean }> {
  const rulesPath = join(runs, "ENGINEER-RULES.md");
  const shaPath = `${rulesPath}.sha256`;
  const [rulesL, shaL] = await Promise.all([
    lstat(rulesPath).catch(() => null),
    lstat(shaPath).catch(() => null),
  ]);
  const bad = (key: string, status: FleetSourceStatus) => {
    sources[key] = status;
    return { entries: [], ok: false };
  };
  if (!rulesL || rulesL.isSymbolicLink() || !rulesL.isFile())
    return bad("rules", rulesL ? "invalid" : "missing");
  if (!shaL || shaL.isSymbolicLink() || !shaL.isFile())
    return bad("rulesSha", shaL ? "invalid" : "missing");
  const rulesBytes = await readFleetBytes(rulesPath);
  const shaBytes = await readFleetBytes(shaPath, 4096);
  sources.rules = rulesBytes.status;
  sources.rulesSha = shaBytes.status;
  if (
    rulesBytes.status !== "ok" ||
    shaBytes.status !== "ok" ||
    !rulesBytes.bytes ||
    !shaBytes.bytes
  )
    return { entries: [], ok: false };
  const want = shaBytes.bytes.toString("utf8").trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{64}$/.test(want) || sha256Hex(rulesBytes.bytes) !== want)
    return { entries: [], ok: false };
  const text = rulesBytes.bytes.toString("utf8");
  const lines = text.split("\n").filter((l) => l.startsWith("7. Hold list"));
  if (lines.length !== 1) return { entries: [], ok: false };
  const l7 = lines[0]!;
  if (!/^7\. Hold list.*:/.test(l7)) return { entries: [], ok: false };
  const body = l7.slice(l7.indexOf(":") + 1).replace(/\.$/, "");
  const entries: { repo: string; prs: Set<string> }[] = [];
  for (const seg of body.split(";")) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return { entries: [], ok: false };
    const repo = tokens[0]!;
    if (!FLEET_REPOS.has(repo)) return { entries: [], ok: false };
    const prs = new Set<string>();
    for (const t of tokens.slice(1)) {
      const m = t.match(/^#(\d+)\.?$/);
      if (!m) return { entries: [], ok: false };
      prs.add(m[1]!);
    }
    entries.push({ repo, prs });
  }
  return { entries, ok: entries.length > 0 };
}

async function loadFleetState(runs: string, queue: string): Promise<FleetState> {
  const sources: Record<string, FleetSourceStatus> = {};
  const readSet = async (path: string, key: string) => {
    const src = await readFleetText(path);
    sources[key] = src.status;
    return src.text;
  };
  const [keepText, landonlyText, readyText, statusJson, skipsText, g1names] = await Promise.all([
    readSet(join(queue, "keep.txt"), "keep"),
    readSet(join(runs, "PUBLISH_LANDONLY"), "landonly"),
    readSet(join(queue, "ready.tsv"), "ready"),
    readFleetJson(join(queue, "status.json"), { object: true }),
    readSet(join(queue, "precheck-skips.tsv"), "precheckSkips"),
    readdir(join(runs, "g1-pass")).then(
      (names) => {
        sources.g1pass = "ok";
        return names;
      },
      (error: unknown) => {
        sources.g1pass =
          (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
        return [] as string[];
      },
    ),
  ]);
  sources.status = statusJson.status;
  const hold = await loadHoldList(runs, sources);

  const queued = new Set<string>();
  for (const line of readyText.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const id = line.split("\t")[0]?.trim();
    if (id && JOB_ID.test(id)) queued.add(id);
  }

  const statusKept = new Set<string>();
  const statusReaping = new Set<string>();
  if (isFleetRow(statusJson.data)) {
    for (const key of ["kept_worktrees", "reaping"] as const) {
      const list = statusJson.data[key];
      if (Array.isArray(list))
        for (const id of list)
          if (typeof id === "string")
            (key === "kept_worktrees" ? statusKept : statusReaping).add(id);
    }
  }

  // DONE-NOOP: dispatchd appends "<TS>\t<job>\t<code>\t<reason>" for precheck exits 10..13.
  const precheckDone = new Set<string>();
  for (const line of skipsText.split("\n")) {
    const f = line.split("\t");
    if (f.length === 4 && f[1] && /^[0-9]{1,2}$/.test(f[2] ?? "")) {
      const code = Number(f[2]);
      if (code >= 10 && code <= 13) precheckDone.add(f[1]);
    }
  }

  return {
    keep: tokenSet(keepText),
    landonly: tokenSet(landonlyText),
    queued,
    statusKept,
    statusReaping,
    g1pass: new Set(g1names.filter((n) => n.endsWith(".pass")).map((n) => n.slice(0, -5))),
    precheckDone,
    holdEntries: hold.entries,
    holdListOk: hold.ok,
    sources,
  };
}

/** Newest mtime under dir; fails closed on unreadable entries or budget exhaustion. */
async function newestTreeMtime(
  root: string,
  deadline: number,
): Promise<{ newest: number; complete: boolean }> {
  let newest = 0;
  let visited = 0;
  let complete = true;
  const stack: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  const note = async (p: string) => {
    const s = await lstat(p).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") complete = false;
      return null;
    });
    if (s && s.mtimeMs > newest) newest = s.mtimeMs;
  };
  while (stack.length) {
    if (Date.now() > deadline || visited > WALK_MAX_ENTRIES) {
      complete = false;
      break;
    }
    const { path, depth } = stack.pop()!;
    let dirents: Dirent[];
    try {
      dirents = await readdir(path, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") complete = false;
      continue;
    }
    for (const d of dirents) {
      if (++visited > WALK_MAX_ENTRIES) {
        complete = false;
        break;
      }
      const p = join(path, d.name);
      if (d.isSymbolicLink()) {
        await note(p);
        continue;
      }
      if (d.isDirectory()) {
        if (WALK_PRUNE_ANYWHERE.has(d.name)) continue;
        if (depth === 0 && WALK_PRUNE_TOP.has(d.name)) continue;
        stack.push({ path: p, depth: depth + 1 });
        await note(p);
        continue;
      }
      await note(p);
    }
  }
  return { newest, complete };
}

interface DeepContext {
  runs: string;
  queue: string;
  state: FleetState;
  now: number;
  reapIdleMs: number;
  emptyIdleMs: number;
  deadline: number;
  lsofOk: boolean;
  lsofText: string;
  ghBin: string;
  ghMax: number;
  ghCalls: number;
  ghSawOk: boolean;
  worktreeMaps: Map<string, Promise<Map<string, WorktreeInfo> | null>>;
  stats: { gitChecks: number; walks: number; budgetExceeded: boolean };
}

async function worktreeMapFor(
  ctx: DeepContext,
  repoPath: string,
): Promise<Map<string, WorktreeInfo> | null> {
  let pending = ctx.worktreeMaps.get(repoPath);
  if (!pending) {
    pending = (async () => {
      if (Date.now() > ctx.deadline) {
        ctx.stats.budgetExceeded = true;
        return null;
      }
      ctx.stats.gitChecks++;
      const res = await runGit(
        ["-C", repoPath, "worktree", "list", "--porcelain", "-z"],
        repoPath,
        20_000,
      );
      if (res.code !== 0) return null;
      const map = new Map<string, WorktreeInfo>();
      for (const w of parseWorktreePorcelain(res.stdout)) map.set(resolve(w.path), w);
      return map;
    })();
    ctx.worktreeMaps.set(repoPath, pending);
  }
  return pending;
}

/** Resolve a linked worktree's owning repo path via its .git file + commondir. */
async function resolveRepo(entryPath: string): Promise<{ repo: string } | { error: string }> {
  const gitPath = join(entryPath, ".git");
  const st = await lstat(gitPath).catch(() => null);
  if (!st) return { error: "git-pointer-missing" };
  if (st.isDirectory()) return { error: "not-a-linked-worktree" };
  if (!st.isFile() || st.isSymbolicLink() || st.size > 8192)
    return { error: "git-pointer-invalid" };
  const text = await readFile(gitPath, "utf8").catch(() => "");
  const m = text.match(/^gitdir:\s*(.+)$/m);
  if (!m) return { error: "git-pointer-invalid" };
  const gitdir = resolve(entryPath, m[1]!.trim());
  const gd = await lstat(gitdir).catch(() => null);
  if (!gd?.isDirectory() || gd.isSymbolicLink()) return { error: "gitdir-missing" };
  let common = "../..";
  const commondirPath = join(gitdir, "commondir");
  const cd = await lstat(commondirPath).catch(() => null);
  if (cd?.isFile() && !cd.isSymbolicLink() && cd.size <= 4096) {
    const commondirText = await readFile(commondirPath, "utf8").catch(() => "");
    if (commondirText.trim()) common = commondirText.trim();
  }
  const commonGit = resolve(gitdir, common);
  if (basename(commonGit) !== ".git") return { error: "repo-unresolved" };
  return { repo: dirname(commonGit) };
}

/** reap-merged held_job: repo from the dispatched .line, else the worktree's repo dir name. */
function heldJob(state: FleetState, job: string, lineText: string, repoName: string): boolean {
  if (!state.holdListOk) return false;
  const lineRepo = (lineText.split("\n")[0]?.split("\t")[1] ?? "").trim();
  const repo = (lineRepo || repoName).replace(/^ashlrai\//, "");
  if (!FLEET_REPOS.has(repo)) return true; // unknown repo => held (fail closed)
  const entry = state.holdEntries.find((h) => h.repo === repo);
  if (!entry) return false;
  const tokens = `${job} ${lineText}`.match(/\d+/g) ?? ([] as string[]);
  for (const pr of entry.prs) if (tokens.includes(pr)) return true;
  return false;
}

/** True when any lsof "n" record is the path itself or sits underneath it. */
function lsofHolds(lsofText: string, path: string): boolean {
  return (
    lsofText.includes(`n${path}/`) ||
    lsofText.includes(`n${path}\n`) ||
    lsofText.endsWith(`n${path}`)
  );
}

/** reap-merged log_finished: proves the agent reached a terminal marker. */
async function logFinished(
  runs: string,
  name: string,
  now: number,
  liveMs: number,
): Promise<{ ok: boolean; reason: string }> {
  const fail = (reason: string) => ({ ok: false, reason });
  const lf = join(runs, `${name}.log`);
  const st = await lstat(lf).catch(() => null);
  if (!st || !st.isFile() || st.isSymbolicLink()) return fail("log-missing");
  if (st.size <= 0) return fail("log-empty");
  if (now - st.mtimeMs < liveMs) return fail("log-recent");
  let tailText: string;
  let lastByteNl = false;
  try {
    const file = await openFleetFile(lf);
    try {
      const size = st.size;
      const len = Math.min(LOG_TAIL, size);
      const buf = Buffer.alloc(len);
      await file.read(buf, 0, len, size - len);
      tailText = buf.toString("utf8").replace(/\r/g, "");
      const last = Buffer.alloc(1);
      await file.read(last, 0, 1, size - 1);
      lastByteNl = last[0] === 0x0a;
    } finally {
      await file.close();
    }
  } catch {
    return fail("log-unreadable");
  }
  if (!lastByteNl) return fail("log-truncated");
  const lines = tailText.split("\n");
  // codex exec: a "tokens used" line immediately followed by a digits line.
  let endMarked = lines.some(
    (l, i) =>
      /^tokens used[ \t]*$/.test(l) && /^[ \t]*[0-9][0-9,]*[ \t]*$/.test(lines[i + 1] ?? ""),
  );
  if (!endMarked) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^API_SPEND ${esc} pool=(gift|monthly) `, "m").test(tailText)) endMarked = true;
  }
  if (!endMarked) {
    const errRe = /^[ \t]*(?:ERROR|Error|API Error|stream error)[: ]/;
    const termRe =
      /usage limit|you've hit your|weekly limit|credits? (are |have been )?(exhausted|depleted)|out of credits|insufficient credits|no credits remaining/i;
    endMarked = lines.some((l) => errRe.test(l) && termRe.test(l));
  }
  if (!endMarked) return fail("log-no-end-marker");
  // log_growing guard: size and mtime must be unchanged since the first stat.
  const st2 = await lstat(lf).catch(() => null);
  if (!st2 || st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) return fail("log-growing");
  return { ok: true, reason: "" };
}

interface CandidateDeep {
  basis: GcBasis;
  baseSha: string;
  branch: string;
  idleThresholdMs: number;
  newestRuns: number;
  publishMtimeMs: number;
  resultPr: { repo: string; pr: string } | null;
  lineText: string;
}

interface Classified {
  entry: GcEntry;
  deep?: CandidateDeep;
}

async function classifyEntry(
  ctx: DeepContext & { root: string },
  name: string,
): Promise<Classified> {
  const entry: GcEntry = { name, path: join(ctx.root, name), class: "preserve", reasons: [] };
  const reasons = entry.reasons;
  const preserve = (reason: string): Classified => {
    reasons.push(reason);
    return { entry };
  };

  if (!JOB_ID.test(name)) return preserve("bad-name");
  if (DENIED_NAME.test(name) || DENIED_NAMES.has(name)) return preserve("denied-name");

  const runs = ctx.runs;
  const queue = ctx.queue;
  const basePath = join(runs, `${name}.base`);
  const baseL = await lstat(basePath).catch(() => null);
  if (!baseL) return preserve("no-job-record");
  if (!baseL.isFile() || baseL.isSymbolicLink()) return preserve("base-invalid");
  const baseText = await readFleetText(basePath);
  if (baseText.status !== "ok") return preserve("base-invalid");
  const fields = baseText.text.split(/\s+/).filter(Boolean);
  if (fields.length < 4) return preserve("base-invalid");
  const baseSha = fields[0]!;
  const branch = fields[1]!;
  const baseWt = fields[2]!;
  if (!/^[0-9a-f]{40}$/.test(baseSha)) return preserve("base-invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(branch)) return preserve("base-invalid");
  // Containment (reap-merged K2): the recorded worktree path must resolve to this entry.
  const baseReal = await realpath(baseWt).catch(() => null);
  if (baseReal !== entry.path) return preserve("base-mismatch");

  const runDir = join(queue, "run");
  const probe = (p: string) => lstat(p).catch(() => null);
  const [
    wtStat,
    dispatched,
    reaping,
    runLock,
    rootLock,
    logF,
    launchF,
    publishF,
    pidRun,
    pidRoot,
    lineF,
  ] = await Promise.all([
    probe(entry.path),
    probe(join(runDir, `${name}.dispatched`)),
    probe(join(runDir, `${name}.reaping`)),
    probe(join(runDir, `${name}.lock`)),
    probe(join(runs, `${name}.lock`)),
    probe(join(runs, `${name}.log`)),
    probe(join(runs, `${name}.launch`)),
    probe(join(runs, `${name}.publish`)),
    probe(join(runDir, `${name}.pid`)),
    probe(join(runs, `${name}.pid`)),
    probe(join(runDir, `${name}.line`)),
  ]);
  if (!wtStat?.isDirectory() || wtStat.isSymbolicLink()) return preserve("not-a-directory");

  // --- tier 1: liveness and claims (mirrors dispatchd alive/reaping/keep sets) ---
  // .dispatched persists for the whole agent run (dispatchd removes it only after
  // the job leaves the alive set), so presence alone means "not provably finished".
  if (dispatched) reasons.push("dispatch-pending");
  if (reaping) reasons.push("reap-claimed");
  if (runLock || rootLock) reasons.push("lock-claimed");
  // First existing pid file decides (reap-merged live_job): live, stale or
  // unverifiable all preserve — the reaper would skip it too.
  const pidStat = pidRun ?? pidRoot;
  if (pidStat) {
    const pidPath = pidRun ? join(runDir, `${name}.pid`) : join(runs, `${name}.pid`);
    const pidText =
      pidStat.isFile() && !pidStat.isSymbolicLink() ? (await readFleetText(pidPath)).text : "";
    const pid = Number(pidText.trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) reasons.push("pid-unknown");
    else {
      try {
        process.kill(pid, 0);
        reasons.push("process-live");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        reasons.push(code === "EPERM" ? "process-live" : "pid-stale");
      }
    }
  }
  if (ctx.state.statusKept.has(name)) reasons.push("status-kept");
  if (ctx.state.statusReaping.has(name)) reasons.push("status-reaping");
  if (ctx.state.keep.has(name)) reasons.push("kept");
  if (ctx.state.queued.has(name)) reasons.push("job-queued");
  const now = ctx.now;
  const recent = Math.max(
    baseL.mtimeMs,
    logF?.mtimeMs ?? 0,
    launchF?.mtimeMs ?? 0,
    publishF?.mtimeMs ?? 0,
    wtStat.mtimeMs,
  );
  if (now - recent < LIVE_WINDOW_MS) reasons.push("recent-activity");
  if (reasons.length) return { entry };

  // --- tier 2: done status -> evidence basis ---
  let basis: GcBasis;
  let resultCls: Exclude<ResultClass, "none"> | null = null;
  let resultPr: { repo: string; pr: string } | null = null;
  const lineText =
    lineF?.isFile() && !lineF.isSymbolicLink()
      ? (await readFleetText(join(runDir, `${name}.line`))).text
      : "";

  if (publishF) {
    const pub = await readFleetText(join(runs, `${name}.publish`));
    if (pub.status !== "ok") return preserve("publish-unreadable");
    const { cls, line } = lastResultClass(pub.text);
    if (!cls) return preserve("publish-unresulted");
    resultCls = cls;
    entry.resultClass = cls;
    if (cls !== "pr" && cls !== "empty") {
      reasons.push(`kept-supervisor:${cls}`);
      entry.jobState = "kept";
      return { entry };
    }
    basis = cls === "pr" ? "result-pr" : "result-empty";
    entry.jobState = "finished";
    if (cls === "pr") {
      const m = line.match(RESULT_PR_RE);
      if (m) resultPr = { repo: m[1]!, pr: m[2]! };
      entry.pr = resultPr ? `ashlrai/${resultPr.repo}#${resultPr.pr}` : undefined;
    }
  } else if (ctx.state.precheckDone.has(name)) {
    basis = "done-noop";
    entry.jobState = "done-noop";
  } else {
    const fin = await logFinished(runs, name, now, LIVE_WINDOW_MS);
    if (!fin.ok) return preserve(fin.reason);
    basis = "empty-inferred";
    entry.jobState = "finished-inferred";
  }

  const idleThresholdMs = basis === "result-pr" ? ctx.reapIdleMs : ctx.emptyIdleMs;
  const newestRuns = Math.max(
    baseL.mtimeMs,
    logF?.mtimeMs ?? 0,
    launchF?.mtimeMs ?? 0,
    publishF?.mtimeMs ?? 0,
    wtStat.mtimeMs,
  );
  return {
    entry,
    deep: {
      basis,
      baseSha,
      branch,
      idleThresholdMs,
      newestRuns,
      publishMtimeMs: publishF?.mtimeMs ?? 0,
      resultPr,
      lineText,
    },
  };
}

/** Deep per-candidate verification: registration, liveness, cleanliness, idle, PR state. */
async function deepCheck(ctx: DeepContext, entry: GcEntry, d: CandidateDeep): Promise<void> {
  const reasons = entry.reasons;
  const bail = (reason: string) => {
    reasons.push(reason);
  };
  if (Date.now() > ctx.deadline) {
    ctx.stats.budgetExceeded = true;
    bail("budget-exceeded");
    return;
  }

  // --- git registration ---
  const resolved = await resolveRepo(entry.path);
  if ("error" in resolved) {
    bail(resolved.error);
    return;
  }
  entry.repo = resolved.repo;
  const repoName = basename(resolved.repo);
  const map = await worktreeMapFor(ctx, resolved.repo);
  if (!map) {
    bail("repo-scan-failed");
    return;
  }
  const info = map.get(resolve(entry.path));
  if (!info) {
    bail("unregistered");
    return;
  }
  if (info.prunable) {
    bail("prunable");
    return;
  }
  if (info.locked) {
    bail("locked");
    return;
  }
  entry.head = info.head || undefined;
  entry.branch = info.branch ? info.branch.replace(/^refs\/heads\//, "") : null;
  entry.detached = info.detached || undefined;

  // --- liveness: one system-wide lsof scan, same evidence reap-merged uses ---
  if (!ctx.lsofOk) {
    bail("lsof-unavailable");
    return;
  }
  const realEntry = await realpath(entry.path).catch(() => entry.path);
  if (
    lsofHolds(ctx.lsofText, entry.path) ||
    (realEntry !== entry.path && lsofHolds(ctx.lsofText, realEntry))
  ) {
    bail("live-process");
    return;
  }

  // --- hold list / publish queue / protected branch (reap-merged gates) ---
  if (d.basis === "result-pr") {
    if (!d.resultPr || !FLEET_REPOS.has(d.resultPr.repo)) {
      bail("repo-unlisted");
      return;
    }
    const rp = d.resultPr;
    const h = rp ? ctx.state.holdEntries.find((e) => e.repo === rp.repo) : undefined;
    if (rp && h?.prs.has(rp.pr)) {
      bail("hold-list");
      return;
    }
    if (PROTECTED_PR.test(d.branch)) {
      bail("protected-branch");
      return;
    }
    if (CLAUDE_BRANCH.test(d.branch) && ctx.now - d.publishMtimeMs < CLAUDE_PUSH_MS) {
      bail("claude-recent-push");
      return;
    }
  } else {
    if (ctx.state.landonly.has(entry.name) || ctx.state.g1pass.has(entry.name)) {
      bail("publish-queued");
      return;
    }
    if (PROTECTED_EMPTY.test(d.branch)) {
      bail("protected-branch");
      return;
    }
    if (heldJob(ctx.state, entry.name, d.lineText, repoName)) {
      bail("held");
      return;
    }
  }

  // --- cleanliness: tracked/untracked plus ignored-file allowance ---
  if (Date.now() > ctx.deadline) {
    ctx.stats.budgetExceeded = true;
    bail("budget-exceeded");
    return;
  }
  ctx.stats.gitChecks++;
  const status = await runGit(
    [
      "--no-optional-locks",
      "-C",
      entry.path,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=traditional",
      "--ignore-submodules=all",
    ],
    entry.path,
  );
  if (status.code !== 0) {
    bail(status.timedOut ? "git-timeout" : "git-error");
    return;
  }
  let dirty = false;
  let badIgnored = false;
  // reap-merged checks the ignored allowlist only on the inferred-DONE path:
  // with no publish record, ignored files may be the only trace of work.
  const checkIgnored = d.basis === "empty-inferred";
  for (const line of status.stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("!!")) {
      if (!checkIgnored) continue;
      // reap-merged ignored_ok: only ignored directories under BUILD_ALLOW pass;
      // a plain ignored file or a quoted path fails closed.
      const raw = line.slice(3);
      if (raw.startsWith('"')) {
        badIgnored = true;
        continue;
      }
      const isDir = raw.endsWith("/");
      const body = isDir ? raw.slice(0, -1) : raw;
      const top = body.split("/")[0] ?? "";
      if (!BUILD_ALLOW.has(top) || (!isDir && !body.includes("/"))) badIgnored = true;
      continue;
    }
    dirty = true;
  }
  if (dirty) {
    bail("dirty");
    return;
  }
  if (badIgnored) {
    bail("ignored-files");
    return;
  }

  if (d.basis === "result-pr") {
    // PR work must be reachable from a remote-tracking ref (publish.sh pushes to fork).
    if (Date.now() > ctx.deadline) {
      ctx.stats.budgetExceeded = true;
      bail("budget-exceeded");
      return;
    }
    ctx.stats.gitChecks++;
    const unpushed = await runGit(
      ["-C", entry.path, "rev-list", "--count", "HEAD", "--not", "--remotes"],
      entry.path,
    );
    if (unpushed.code !== 0) {
      bail(unpushed.timedOut ? "git-timeout" : "git-error");
      return;
    }
    if (unpushed.stdout.trim() !== "0") {
      bail("unpushed-commits");
      return;
    }
  } else {
    // Empty family: provably nothing beyond the recorded base (reap-merged --empty).
    if (Date.now() > ctx.deadline) {
      ctx.stats.budgetExceeded = true;
      bail("budget-exceeded");
      return;
    }
    ctx.stats.gitChecks++;
    const ahead = await runGit(
      ["-C", entry.path, "rev-list", "--count", `${d.baseSha}..HEAD`],
      entry.path,
    );
    if (ahead.code !== 0) {
      bail(ahead.timedOut ? "git-timeout" : "git-error");
      return;
    }
    if (ahead.stdout.trim() !== "0") {
      bail("unpublished-work");
      return;
    }
    ctx.stats.gitChecks++;
    const diff = await runGit(
      [
        "-C",
        entry.path,
        "diff",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=all",
        d.baseSha,
        "--",
      ],
      entry.path,
    );
    if (diff.code === null || (diff.code !== 0 && diff.code !== 1)) {
      bail(diff.timedOut ? "git-timeout" : "git-error");
      return;
    }
    if (diff.code === 1) {
      bail("unpublished-work");
      return;
    }
  }

  // --- idle: newest of runs-side markers and the pruned worktree walk ---
  if (Date.now() > ctx.deadline) {
    ctx.stats.budgetExceeded = true;
    bail("budget-exceeded");
    return;
  }
  ctx.stats.walks++;
  const walk = await newestTreeMtime(entry.path, ctx.deadline);
  if (!walk.complete) {
    bail("walk-incomplete");
    return;
  }
  const newest = Math.max(
    d.newestRuns,
    walk.newest,
    (await lstat(entry.path).catch(() => null))?.mtimeMs ?? 0,
  );
  const idleHours = (ctx.now - newest) / 3_600_000;
  entry.idleHours = Math.round(idleHours * 100) / 100;
  if (idleHours * 3_600_000 < d.idleThresholdMs) {
    bail("idle-below-threshold");
    return;
  }

  // --- result-pr only: the PR must be MERGED or CLOSED (reap-merged gh gate) ---
  if (d.basis === "result-pr") {
    if (!d.resultPr) {
      bail("pr-unparsed");
      return;
    }
    if (ctx.ghCalls >= ctx.ghMax) {
      bail("gh-budget");
      return;
    }
    ctx.ghCalls++;
    const gh = await runProc(
      ctx.ghBin,
      [
        "pr",
        "view",
        d.resultPr.pr,
        "--repo",
        `ashlrai/${d.resultPr.repo}`,
        "--json",
        "state",
        "-q",
        ".state",
      ],
      entry.path,
      15_000,
      1024 * 1024,
    );
    if (gh.code === null) {
      bail("gh-unavailable");
      return;
    }
    if (gh.code === 0) ctx.ghSawOk = true;
    if (gh.code !== 0) {
      bail(gh.timedOut ? "gh-timeout" : "pr-state-unknown");
      return;
    }
    const state = gh.stdout.trim().toUpperCase();
    if (state === "OPEN") {
      bail("pr-open");
      return;
    }
    if (state !== "MERGED" && state !== "CLOSED") {
      bail("pr-state-unknown");
      return;
    }
  }

  entry.class = "collect-candidate";
  entry.basis = d.basis;
  entry.reasons = [];
}

export interface FleetGcReport {
  schemaVersion: 1;
  mode: "dry-run";
  generatedAt: string;
  root: string;
  runs: string;
  queue: string;
  thresholds: { reapIdleHours: number; emptyIdleHours: number; budgetSeconds: number };
  sources: Record<string, FleetSourceStatus>;
  tools: { lsof: "ok" | "unavailable"; gh: "ok" | "unused" | "unavailable" };
  reposScanned: number;
  scan: {
    complete: boolean;
    entries: number;
    skippedNonDirs: number;
    gitChecks: number;
    walks: number;
    ghCalls: number;
    budgetExceeded: boolean;
    durationMs: number;
  };
  summary: {
    total: number;
    byClass: Record<GcClass, number>;
    byBasis: Record<string, number>;
    byReason: Record<string, number>;
    byResultClass: Record<string, number>;
  };
  staleRegistrations: { count: number; sample: string[] };
  entries: GcEntry[];
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    const st = await lstat(p).catch(() => null);
    if (st) return p;
  }
  return null;
}

export async function collectFleetGc(options: FleetGcOptions): Promise<FleetGcReport> {
  const started = Date.now();
  const now = options.now ?? started;
  const root = await realpath(resolve(options.root)).catch(() => resolve(options.root));
  const runs = resolve(options.runs);
  const queue = resolve(options.queue ?? join(runs, "queue"));
  const reapIdleHours = options.reapIdleHours ?? 2;
  const emptyIdleHours = options.emptyIdleHours ?? 6;
  const budgetSeconds = options.budgetSeconds ?? 120;
  const ghMax = options.ghMax ?? GH_MAX_DEFAULT;

  const sources: Record<string, FleetSourceStatus> = {};
  const dirents = await readdir(root, { withFileTypes: true }).then(
    (d) => {
      sources.root = "ok";
      return d;
    },
    (error: unknown) => {
      sources.root = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
      return [] as Dirent[];
    },
  );
  sources.runs = await lstat(runs)
    .then((s) => (s.isDirectory() ? "ok" : "invalid"))
    .catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? "missing" : "unavailable"));

  const names = dirents
    .filter((d) => d.isDirectory() && !d.isSymbolicLink())
    .map((d) => d.name)
    .sort();
  const skippedNonDirs = dirents.length - names.length;

  const state = await loadFleetState(runs, queue);
  Object.assign(sources, state.sources);

  // Discover owning repositories: siblings of the worktree root with a .git entry.
  const repoPaths = new Set<string>();
  const parent = dirname(root);
  const siblings = await readdir(parent, { withFileTypes: true }).catch(() => [] as Dirent[]);
  for (const d of siblings) {
    if (!d.isDirectory() || d.isSymbolicLink()) continue;
    const candidate = join(parent, d.name);
    const gitEntry = await lstat(join(candidate, ".git")).catch(() => null);
    if (gitEntry && (gitEntry.isDirectory() || gitEntry.isFile())) repoPaths.add(candidate);
  }

  // lsof: one system-wide scan, same evidence reap-merged/reap-one use for live fds.
  const lsofBin =
    options.lsofBin ??
    (await firstExisting(["/usr/sbin/lsof", "/usr/bin/lsof", "/usr/local/bin/lsof"]));
  let lsofOk = false;
  let lsofText = "";
  if (lsofBin) {
    const lo = await runProc(lsofBin, ["-nP", "-w", "-Fn"], root, 30_000, 64 * 1024 * 1024);
    // reap-merged: a nonzero exit only fails when the output is empty.
    lsofOk = lo.code === 0 || lo.stdout.length > 0;
    lsofText = lo.stdout;
  }
  sources.lsof = lsofOk ? "ok" : "unavailable";

  const ghCandidates = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];
  if (process.env.HOME) ghCandidates.push(join(process.env.HOME, ".local", "bin", "gh"));
  const ghBin = options.ghBin ?? (await firstExisting(ghCandidates)) ?? "gh";

  const deadline = started + budgetSeconds * 1000;
  const ctx: DeepContext & { root: string } = {
    root,
    runs,
    queue,
    state,
    now,
    reapIdleMs: reapIdleHours * 3_600_000,
    emptyIdleMs: emptyIdleHours * 3_600_000,
    deadline,
    lsofOk,
    lsofText,
    ghBin,
    ghMax,
    ghCalls: 0,
    ghSawOk: false,
    worktreeMaps: new Map(),
    stats: { gitChecks: 0, walks: 0, budgetExceeded: false },
  };

  // Warm the worktree maps for discovered repos (bounded, parallel).
  const repoList = [...repoPaths];
  let ri = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, repoList.length) }, async () => {
      while (ri < repoList.length) {
        const repo = repoList[ri++]!;
        await worktreeMapFor(ctx, repo);
      }
    }),
  );

  // Phase 1: cheap fleet-state classification for every entry.
  const classified: Classified[] = [];
  const CHUNK = 64;
  for (let i = 0; i < names.length; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK);
    classified.push(...(await Promise.all(chunk.map((n) => classifyEntry(ctx, n)))));
  }

  // Phase 2: deep verification for candidate-eligible entries (parallel, budgeted).
  // A broken hold list fails closed for every candidate (reap-merged K1).
  const deepOnes = classified.filter((c) => c.deep);
  let di = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, deepOnes.length) }, async () => {
      while (di < deepOnes.length) {
        const c = deepOnes[di++]!;
        if (!state.holdListOk) {
          c.entry.reasons.push("hold-list-unknown");
          continue;
        }
        await deepCheck(ctx, c.entry, c.deep!);
      }
    }),
  );

  // Stale registrations: repo worktrees under root whose path is missing on disk.
  const staleRegistrations: string[] = [];
  const nameSet = new Set(names);
  for (const pending of ctx.worktreeMaps.values()) {
    const map = await pending;
    if (!map) continue;
    for (const p of map.keys()) {
      if (dirname(p) !== root) continue;
      const rel = p.slice(root.length + 1);
      if (!rel || rel.includes("/")) continue;
      if (nameSet.has(rel)) continue;
      const exists = await lstat(p).then(
        () => true,
        () => false,
      );
      if (!exists) staleRegistrations.push(rel);
    }
  }
  staleRegistrations.sort();

  const entries = classified.map((c) => c.entry);
  const byClass: Record<GcClass, number> = { preserve: 0, "collect-candidate": 0 };
  const byBasis: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const byResultClass: Record<string, number> = {};
  for (const e of entries) {
    byClass[e.class]++;
    if (e.basis) byBasis[e.basis] = (byBasis[e.basis] ?? 0) + 1;
    if (e.resultClass) byResultClass[e.resultClass] = (byResultClass[e.resultClass] ?? 0) + 1;
    for (const r of e.reasons) byReason[r] = (byReason[r] ?? 0) + 1;
  }

  return {
    schemaVersion: 1,
    mode: "dry-run",
    generatedAt: new Date(now).toISOString(),
    root,
    runs,
    queue,
    thresholds: { reapIdleHours, emptyIdleHours, budgetSeconds },
    sources,
    tools: {
      lsof: lsofOk ? "ok" : "unavailable",
      gh: ctx.ghCalls === 0 ? "unused" : ctx.ghSawOk ? "ok" : "unavailable",
    },
    reposScanned: ctx.worktreeMaps.size,
    scan: {
      complete: !ctx.stats.budgetExceeded,
      entries: entries.length,
      skippedNonDirs,
      gitChecks: ctx.stats.gitChecks,
      walks: ctx.stats.walks,
      ghCalls: ctx.ghCalls,
      budgetExceeded: ctx.stats.budgetExceeded,
      durationMs: Date.now() - started,
    },
    summary: {
      total: entries.length,
      byClass,
      byBasis,
      byReason,
      byResultClass,
    },
    staleRegistrations: {
      count: staleRegistrations.length,
      sample: staleRegistrations.slice(0, 50),
    },
    entries,
  };
}
