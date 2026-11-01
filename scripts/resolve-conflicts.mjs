#!/usr/bin/env node
// Deterministic lane-side merge-conflict resolver — no model calls, no guessing.
//
// Usage (run at the repo root while a rebase or merge is stopped on conflicts):
//   node scripts/resolve-conflicts.mjs [--dry-run] [--main-side ours|theirs]
//
// Policy per conflicted path (matched by basename, at any depth):
//   CHANGELOG.md            union-merge both sides (same result the merge=union
//                           driver in .gitattributes produces on lane-side merges;
//                           GitHub's server merge ignores drivers — this is the backstop).
//   README.md, CLAUDE.md    take the main side's version, then re-apply the
//                           PR's own hunk: a 3-way merge of (base -> PR) onto
//                           main's content where every conflicted region
//                           resolves to the PR side (`git merge-file --theirs`).
//   lockfiles               take the main side's lockfile and let the package
//                           manager regenerate/validate it. Never hand-merged,
//                           never resolved line-by-line. Manifests untouched.
//   anything else           reported as manual; exit code 1.
//
// "Main side" is stage 2 (ours) during a rebase, stage 3 (theirs) when merging
// upstream into a lane; detected automatically, overridable with --main-side.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNION_FILES = new Set(['CHANGELOG.md']);
export const MAIN_THEN_PR_FILES = new Set(['README.md', 'CLAUDE.md']);
// Each entry: the command(s) that regenerate the lockfile against the kept
// (main-side) copy. Versions stay frozen — the PM only resolves entries the
// merge could not. Cargo additionally verifies with --locked afterwards.
export const LOCKFILES = new Map([
  ['bun.lock', [['bun', ['install']]]],
  ['bun.lockb', [['bun', ['install']]]],
  [
    'Cargo.lock',
    [
      ['cargo', ['generate-lockfile']],
      ['cargo', ['metadata', '--locked', '--format-version', '1']],
    ],
  ],
  ['package-lock.json', [['npm', ['install', '--package-lock-only']]]],
  ['pnpm-lock.yaml', [['pnpm', ['install', '--lockfile-only']]]],
  ['yarn.lock', [['yarn', ['install']]]],
]);

const git = (cwd, args, opts = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

const defaultPmRunner = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe' });

// path -> Map(stage -> blobSha) for every unmerged path.
export function unmerged(root) {
  const out = git(root, ['ls-files', '-u', '-z']);
  const paths = new Map();
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const meta = rec.slice(0, tab).split(' ');
    const path = rec.slice(tab + 1);
    if (!paths.has(path)) paths.set(path, new Map());
    paths.get(path).set(Number(meta[2]), meta[1]);
  }
  return paths;
}

// Stage number that holds "main's version": during rebase ours (2) is the
// branch being rebased onto; during a merge of upstream into a lane it is
// theirs (3). Override returns the raw stage (2 or 3).
export function mainStage(root, override) {
  if (override === 'ours' || override === 2) return 2;
  if (override === 'theirs' || override === 3) return 3;
  const dir = resolve(root, git(root, ['rev-parse', '--git-dir']).trim());
  if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) return 2;
  if (existsSync(join(dir, 'MERGE_HEAD'))) return 3;
  return 2;
}

const stageContent = (root, path, stage, stages, { binary = false } = {}) =>
  stages.has(stage)
    ? git(root, ['show', `:${stage}:${path}`], binary ? { encoding: 'buffer' } : {})
    : null;

export function classify(path) {
  const base = basename(path);
  if (UNION_FILES.has(base)) return 'union';
  if (MAIN_THEN_PR_FILES.has(base)) return 'main-then-pr-hunk';
  if (LOCKFILES.has(base)) return 'regen-lockfile';
  return 'manual';
}

// 3-way file merge of temp blobs; `favor` is --union or --theirs.
export function mergeFile(favor, ours, base, theirs) {
  const dir = mkdtempSync(join(tmpdir(), 'mergefile-'));
  try {
    for (const [name, body] of [['ours', ours], ['base', base], ['theirs', theirs]])
      writeFileSync(join(dir, name), body ?? '');
    return git(dir, ['merge-file', '-p', favor, 'ours', 'base', 'theirs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Both sides of a changelog conflict, kept whole — the union merge driver.
export const unionMerge = (ours, base, theirs) => mergeFile('--union', ours, base, theirs);

// Main's version + only the hunk the PR commit itself introduced: a 3-way merge
// of (base -> PR) onto main's content where every conflicted region resolves to
// the PR side. Deterministic — it either merges or the file stays conflicted.
export function applyPrHunk(root, path, baseContent, mainContent, prContent) {
  if (mainContent === null) {
    // File does not exist on the main side — main's version wins: delete.
    git(root, ['rm', '-q', '-f', '--', path]);
    return { ok: true, how: 'deleted (absent on main)' };
  }
  if (prContent === null) {
    // PR deleted it; main's version is kept as-is.
    writeFileSync(join(root, path), mainContent);
    git(root, ['add', '--', path]);
    return { ok: true, how: 'kept main (deleted on PR)' };
  }
  if (baseContent === null) {
    // Added on both sides: no single "PR hunk" exists. Union them — docs are additive.
    writeFileSync(join(root, path), unionMerge(mainContent, '', prContent));
    git(root, ['add', '--', path]);
    return { ok: true, how: 'union (added on both sides)' };
  }
  try {
    writeFileSync(join(root, path), mergeFile('--theirs', mainContent, baseContent, prContent));
  } catch {
    return { ok: false, why: '3-way merge onto main failed; left conflicted' };
  }
  git(root, ['add', '--', path]);
  return { ok: true, how: 'main + PR hunk (merge-file --theirs)' };
}

export function regenLockfile(root, path, mainContent, cmds, run) {
  if (mainContent === null) {
    git(root, ['rm', '-q', '-f', '--', path]);
    return { ok: true, how: 'deleted (absent on main)' };
  }
  writeFileSync(join(root, path), mainContent);
  for (const [cmd, args] of cmds) {
    try {
      run(cmd, args, dirname(join(root, path)));
    } catch (e) {
      return { ok: false, why: `${cmd} ${args.join(' ')} failed: ${e.message.split('\n')[0]}` };
    }
  }
  git(root, ['add', '--', path]);
  return { ok: true, how: `main lockfile + ${cmds.map(([c, a]) => `${c} ${a[0]}`).join(' && ')}` };
}

export function resolveAll(root, { mainSide, pmRunner = defaultPmRunner } = {}) {
  const entries = unmerged(root);
  const mSt = mainStage(root, mainSide);
  const pSt = mSt === 2 ? 3 : 2;
  const resolved = new Map();
  const manual = new Map();
  for (const [path, stages] of [...entries].sort()) {
    const policy = classify(path);
    const binary = policy === 'regen-lockfile' && basename(path).endsWith('.lockb');
    const base = stageContent(root, path, 1, stages, { binary });
    const main = stageContent(root, path, mSt, stages, { binary });
    const pr = stageContent(root, path, pSt, stages, { binary });
    let r;
    if (policy === 'union') {
      if (main === null || pr === null) {
        // One side deleted the changelog — keep the surviving version, lose nothing.
        const keep = main ?? pr;
        if (keep === null) {
          git(root, ['rm', '-q', '-f', '--', path]);
          r = { ok: true, how: 'deleted on both sides' };
        } else {
          writeFileSync(join(root, path), keep);
          git(root, ['add', '--', path]);
          r = { ok: true, how: 'union (kept modified side)' };
        }
      } else {
        writeFileSync(join(root, path), unionMerge(main, base, pr));
        git(root, ['add', '--', path]);
        r = { ok: true, how: 'union' };
      }
    } else if (policy === 'main-then-pr-hunk') {
      r = applyPrHunk(root, path, base, main, pr);
    } else if (policy === 'regen-lockfile') {
      r = regenLockfile(root, path, main, LOCKFILES.get(basename(path)), pmRunner);
    } else {
      r = { ok: false, why: 'no deterministic policy for this path' };
    }
    (r.ok ? resolved : manual).set(path, r.how ?? r.why);
  }
  return { resolved, manual };
}

export function main(argv) {
  const args = argv.slice(2);
  const dry = args.includes('--dry-run');
  const sideIdx = args.indexOf('--main-side');
  const mainSide = sideIdx >= 0 ? args[sideIdx + 1] : undefined;
  const root = git('.', ['rev-parse', '--show-toplevel']).trim();
  const { resolved, manual } = dry
    ? { resolved: new Map(), manual: unmerged(root) }
    : resolveAll(root, { mainSide });
  if (dry) {
    for (const path of [...manual.keys()].sort())
      console.log(`${classify(path).padEnd(18)} ${path}`);
    return 0;
  }
  for (const [path, how] of resolved) console.log(`resolved ${path}  -  ${how}`);
  for (const [path, why] of manual) console.log(`MANUAL   ${path}  -  ${why}`);
  if (manual.size) {
    console.error(`${manual.size} conflict(s) need a human; ${resolved.size} resolved.`);
    return 1;
  }
  console.log(`${resolved.size} file(s) resolved. Continue: git rebase --continue (or git merge --continue).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main(process.argv));
