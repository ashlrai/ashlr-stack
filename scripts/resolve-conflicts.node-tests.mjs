import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, resolveAll, unmerged } from './resolve-conflicts.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'resolve-conflicts.mjs');
const ATTRIBUTES = readFileSync(join(REPO_ROOT, '.gitattributes'), 'utf8');

const envFor = (home) => ({
  ...process.env,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
});

const git = (root, args) => spawnSync('git', args, { cwd: root, env: envFor(root), encoding: 'utf8' });
const gitOk = (root, args) => {
  const r = git(root, args);
  assert.equal(r.status, 0, `git ${args.join(' ')} -> ${r.status}: ${r.stderr}`);
  return r.stdout;
};
const write = (root, rel, body) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const unmergedSet = (root) => new Set(unmerged(root).keys());

// Fixture repo: base commit on main, a diverged `pr` branch, then `git rebase main`.
function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'resolve-conflicts-'));
  gitOk(root, ['init', '-b', 'main', '-q']);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  gitOk(root, ['add', '-A']);
  gitOk(root, ['commit', '-qm', 'base']);
  return root;
}
function rebased(root, prFiles, mainFiles) {
  gitOk(root, ['checkout', '-qb', 'pr']);
  for (const [rel, body] of Object.entries(prFiles)) write(root, rel, body);
  gitOk(root, ['commit', '-qam', 'pr']);
  gitOk(root, ['checkout', '-q', 'main']);
  for (const [rel, body] of Object.entries(mainFiles)) write(root, rel, body);
  gitOk(root, ['commit', '-qam', 'main']);
  gitOk(root, ['checkout', '-q', 'pr']);
  return git(root, ['rebase', 'main']);
}
const CLI = (root, args = []) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env: envFor(root), encoding: 'utf8' });

// Acceptance: the shipped .gitattributes union driver resolves a diverged
// CHANGELOG during `git rebase` — deterministic, no model call.
test('CHANGELOG.md: rebase union-merges via .gitattributes', () => {
  const root = makeRepo({
    '.gitattributes': ATTRIBUTES,
    'CHANGELOG.md': '# Ch\n\n## 1.0.0\n- base\n',
  });
  // Both sides insert a new section at the same anchor — a real conflict
  // for the default merge; the union driver resolves it automatically.
  const r = rebased(
    root,
    { 'CHANGELOG.md': '# Ch\n\n## 1.1.0\n- pr entry\n\n## 1.0.0\n- base\n' },
    { 'CHANGELOG.md': '# Ch\n\n## 0.9.0\n- main entry\n\n## 1.0.0\n- base\n' },
  );
  assert.equal(r.status, 0, r.stderr);
  const ch = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(ch, /pr entry/);
  assert.match(ch, /main entry/);
  assert.doesNotMatch(ch, /<{7}|={7}|>{7}/);
  assert.equal(unmerged(root).size, 0);
  assert.equal(git(root, ['status', '--porcelain']).stdout.trim(), '');
  rmSync(root, { recursive: true, force: true });
});

// Same conflict without the attribute: the script is the union backstop.
test('CHANGELOG.md: script union-merges when the driver did not fire', () => {
  const root = makeRepo({ 'CHANGELOG.md': '# Ch\n\n## 1.0.0\n- base\n' });
  const r = rebased(
    root,
    { 'CHANGELOG.md': '# Ch\n\n## 1.1.0\n- pr entry\n\n## 1.0.0\n- base\n' },
    { 'CHANGELOG.md': '# Ch\n\n## 0.9.0\n- main entry\n\n## 1.0.0\n- base\n' },
  );
  assert.notEqual(r.status, 0);
  assert.ok(unmergedSet(root).has('CHANGELOG.md'));
  const { resolved, manual } = resolveAll(root);
  assert.equal(manual.size, 0);
  assert.ok(resolved.has('CHANGELOG.md'));
  const ch = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(ch, /pr entry/);
  assert.match(ch, /main entry/);
  gitOk(root, ['rebase', '--continue']);
  rmSync(root, { recursive: true, force: true });
});

// README/CLAUDE policy: main's version kept, the PR's own hunk re-applied.
test('README.md and CLAUDE.md: main version + PR hunk, via CLI', () => {
  const baseReadme = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n';
  const root = makeRepo({
    '.gitattributes': ATTRIBUTES,
    'README.md': baseReadme,
    'CLAUDE.md': 'c1\nc2\nc3\n',
  });
  const r = rebased(
    root,
    {
      'README.md': 'l1\nl2-PR\nl3\nl4\nl5\nl6\nl7\nl8-PR\n',
      'CLAUDE.md': 'c1\nc2-PR\nc3\n',
    },
    {
      'README.md': 'l1\nl2-MAIN\nl3\nl4\nl5-MAIN\nl6\nl7\nl8\nMAIN-APPEND\n',
      'CLAUDE.md': 'c1\nc2-MAIN\nc3\n',
    },
  );
  assert.notEqual(r.status, 0);
  assert.ok(unmergedSet(root).has('README.md'));
  assert.ok(unmergedSet(root).has('CLAUDE.md'));
  const cli = CLI(root);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  // Conflict regions resolve to the PR hunk; main-only content survives.
  assert.equal(
    readFileSync(join(root, 'README.md'), 'utf8'),
    'l1\nl2-PR\nl3\nl4\nl5-MAIN\nl6\nl7\nl8-PR\n',
  );
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), 'c1\nc2-PR\nc3\n');
  assert.equal(unmerged(root).size, 0);
  gitOk(root, ['rebase', '--continue']);
  rmSync(root, { recursive: true, force: true });
});

// Lockfiles: never hand-merged — main's lockfile is kept and the package
// manager regenerates/validates it. The manifest is left untouched.
test('bun.lock: main lockfile + `bun install`, package.json untouched', () => {
  const pkg = '{"name":"x","private":true}\n';
  const baseLock = '{"lockfileVersion":0,"deps":["a@1.0.0"]}\n';
  const mainLock = '{"lockfileVersion":0,"deps":["a@1.0.0","b@2.0.0"]}\n';
  const prLock = '{"lockfileVersion":0,"deps":["a@1.0.0","c@3.0.0"]}\n';
  const root = makeRepo({ 'package.json': pkg, 'bun.lock': baseLock });
  const r = rebased(root, { 'bun.lock': prLock }, { 'bun.lock': mainLock });
  assert.notEqual(r.status, 0);
  assert.ok(unmergedSet(root).has('bun.lock'));
  const calls = [];
  const { resolved, manual } = resolveAll(root, {
    pmRunner: (cmd, args, cwd) => calls.push([cmd, args, cwd]),
  });
  assert.equal(manual.size, 0);
  assert.ok(resolved.has('bun.lock'));
  assert.equal(readFileSync(join(root, 'bun.lock'), 'utf8'), mainLock);
  assert.deepEqual(calls, [['bun', ['install'], root]]);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), pkg);
  rmSync(root, { recursive: true, force: true });
});

// Anything outside the three policies stays conflicted for a human.
test('unclassified conflicts are left for a human (exit 1)', () => {
  const root = makeRepo({ 'notes.txt': 'a\nb\nc\n' });
  const r = rebased(root, { 'notes.txt': 'a\nB-pr\nc\n' }, { 'notes.txt': 'a\nB-main\nc\n' });
  assert.notEqual(r.status, 0);
  const { resolved, manual } = resolveAll(root);
  assert.equal(resolved.size, 0);
  assert.ok(manual.has('notes.txt'));
  assert.ok(unmergedSet(root).has('notes.txt'));
  assert.equal(CLI(root).status, 1);
  const cli = CLI(root, ['--dry-run']);
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /manual\s+notes.txt/);
  rmSync(root, { recursive: true, force: true });
});

test('classify maps basenames at any depth', () => {
  assert.equal(classify('CHANGELOG.md'), 'union');
  assert.equal(classify('packages/x/CHANGELOG.md'), 'union');
  assert.equal(classify('README.md'), 'main-then-pr-hunk');
  assert.equal(classify('docs/CLAUDE.md'), 'main-then-pr-hunk');
  assert.equal(classify('bun.lock'), 'regen-lockfile');
  assert.equal(classify('packages/y/Cargo.lock'), 'regen-lockfile');
  assert.equal(classify('src/app.ts'), 'manual');
});
