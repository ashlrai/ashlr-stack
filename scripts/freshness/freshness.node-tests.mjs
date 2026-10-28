import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, check, GENERATORS, listTargets, parseBlocks, sync } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V = '9.9.9';

function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fresh-'));
  const base = {
    'package.json': JSON.stringify({ name: 'mono', version: '1.2.3', private: true }),
    'packages/core/package.json': JSON.stringify({ name: '@x/core', version: V }),
    'packages/cli/package.json': JSON.stringify({ name: '@x/cli', version: V }),
    'packages/mcp/package.json': JSON.stringify({ name: 'x-mcp', version: V }),
    'packages/mcp/server.json': JSON.stringify({ version: V, packages: [{ identifier: 'x-mcp', version: V }] }),
    'packages/cli/src/index.ts': `const VERSION = "${V}";\n`,
    'CHANGELOG.md': `# Changelog\n\n## Unreleased\n\n## ${V} (2026-10-26)\n\n- things\n`,
    ...files,
  };
  for (const [rel, body] of Object.entries(base)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const begin = (name) => `<!-- fresh:begin ${name} -->`;
const END = '<!-- fresh:end -->';
const run = (script, root) => spawnSync(process.execPath, [join(HERE, script), '--root', root], { encoding: 'utf8' });

test('version-pin regenerates a bare release version inline and standalone', () => {
  const root = repo();
  const { ctx, errors } = buildContext(root);
  assert.deepEqual(errors, []);
  assert.equal(GENERATORS['version-pin'].generate(ctx, 'README.md'), V);
  const { blocks, errors: parseErrors } = parseBlocks(`pin ${begin('version-pin')}${V}${END} rest\n`, 'README.md');
  assert.deepEqual(parseErrors, []);
  assert.equal(blocks[0].inline, true);
  assert.equal(blocks[0].inner, V);
  rmSync(root, { recursive: true });
});

test('version-badge emits a shields badge pinned to source, linking to the changelog', () => {
  const root = repo();
  const { ctx, errors } = buildContext(root);
  assert.deepEqual(errors, []);
  assert.equal(
    GENERATORS['version-badge'].generate(ctx, 'README.md'),
    `[![source v${V}](https://img.shields.io/badge/source-v${V}-blue.svg)](CHANGELOG.md)`,
  );
  // From docs/ the badge must link one level up to the changelog.
  assert.ok(GENERATORS['version-badge'].generate(ctx, 'docs/guide.md').endsWith('](../CHANGELOG.md)'));
  rmSync(root, { recursive: true });
});

test('install-snippet pins both shipped packages to the release version', () => {
  const root = repo();
  const { ctx, errors } = buildContext(root);
  assert.deepEqual(errors, []);
  const out = GENERATORS['install-snippet'].generate(ctx, 'README.md');
  assert.match(out, /^```bash\n/);
  assert.ok(out.includes(`@x/cli@${V}`));
  assert.ok(out.includes(`x-mcp@${V}`));
  assert.match(out, /```$/);
  rmSync(root, { recursive: true });
});

test('version-table lists every manifest version plus the latest changelog section', () => {
  const root = repo();
  const { ctx, errors } = buildContext(root);
  assert.deepEqual(errors, []);
  const out = GENERATORS['version-table'].generate(ctx, 'STACK.md');
  for (const pkg of ['@x/core', '@x/cli', 'x-mcp', 'mono']) assert.ok(out.includes(pkg), `missing ${pkg}`);
  for (const m of ['packages/core/package.json', 'packages/cli/package.json', 'packages/mcp/package.json']) {
    assert.ok(out.includes(m), `missing ${m}`);
  }
  assert.ok(out.includes(`${V} (2026-10-26)`), 'missing changelog heading');
  rmSync(root, { recursive: true });
});

test('check exits nonzero on seeded drift and zero after sync', () => {
  const root = repo({
    'README.md': [
      `# heading`,
      ``,
      begin('version-badge'),
      `[![source v0.0.0](https://img.shields.io/badge/source-v0.0.0-blue.svg)](CHANGELOG.md)`,
      END,
      ``,
      `this checkout is version ${begin('version-pin')}0.0.0${END}.`,
      ``,
      begin('install-snippet'),
      '```bash',
      'bun add -g @x/cli@0.0.0 x-mcp@0.0.0     # or: npm i -g',
      '```',
      END,
      ``,
      begin('version-table'),
      '| Package | Manifest | Version |',
      '| --- | --- | --- |',
      '| `@x/cli` | `packages/cli/package.json` | 0.0.0 |',
      END,
      ``,
    ].join('\n'),
  });
  const drift = run('check.mjs', root);
  assert.notEqual(drift.status, 0, `expected drift, got: ${drift.stdout}${drift.stderr}`);
  assert.match(drift.stderr, /DRIFT/);
  const synced = run('sync.mjs', root);
  assert.equal(synced.status, 0, synced.stderr);
  const clean = run('check.mjs', root);
  assert.equal(clean.status, 0, clean.stderr);
  const text = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(text.includes(`version ${begin('version-pin')}${V}${END}`), 'pin not rewritten');
  rmSync(root, { recursive: true });
});

test('a clean tree passes check with zero drift', () => {
  const root = repo({
    'STACK.md': `${begin('version-pin')}\n${V}\n${END}\n`,
    'docs/x.md': `v is ${begin('version-pin')}${V}${END} here\n`,
    'templates/t/y.md': `${begin('version-pin')}${V}${END}\n`,
  });
  const { drifts, errors, blocks } = check(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(drifts, []);
  assert.equal(blocks, 3);
  rmSync(root, { recursive: true });
});

test('malformed markers and unknown block names are errors, not drift', () => {
  const root = repo({
    'README.md': [begin('does-not-exist'), 'x', END, `orphan ${END}`, `${begin('version-pin')}unclosed`].join('\n'),
  });
  const { errors } = check(root);
  assert.ok(errors.some((e) => e.includes("unknown fresh block 'does-not-exist'")), errors.join(';'));
  assert.ok(errors.some((e) => e.includes('fresh:end without a matching fresh:begin')), errors.join(';'));
  assert.ok(errors.some((e) => e.includes('must close on the same line')), errors.join(';'));
  const res = run('check.mjs', root);
  assert.equal(res.status, 1);
  rmSync(root, { recursive: true });
});

test('manifest, changelog and code version mismatches fail the context', () => {
  const root = repo({
    'packages/mcp/package.json': JSON.stringify({ name: 'x-mcp', version: '8.8.8' }),
  });
  let { errors } = buildContext(root);
  assert.ok(errors.some((e) => e.includes('must share packages/cli/package.json version')), errors.join(';'));
  rmSync(root, { recursive: true });

  const root2 = repo({ 'CHANGELOG.md': `# Changelog\n\n## 8.8.8 (2026-01-01)\n` });
  ({ errors } = buildContext(root2));
  assert.ok(errors.some((e) => e.includes('latest released CHANGELOG.md section is 8.8.8')), errors.join(';'));
  const res = run('check.mjs', root2);
  assert.equal(res.status, 1);
  rmSync(root2, { recursive: true });
});

test('marker text inside fenced code blocks is ignored', () => {
  const doc = [
    '```markdown',
    `${begin('version-pin')}0.0.0${END}`,
    begin('version-pin'),
    '```',
    `real ${begin('version-pin')}${V}${END}`,
    '',
  ].join('\n');
  const { blocks, errors } = parseBlocks(doc, 'README.md');
  assert.deepEqual(errors, []);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].line, 5);
});

test('scan targets cover README, STACK, CHANGELOG, docs and templates', () => {
  const root = repo({
    'README.md': '',
    'STACK.md': '',
    'docs/a.md': `${begin('version-pin')}${V}${END}\n`,
    'docs/nested/b.md': '',
    'templates/t/README.md': '',
    'scripts/ignored.md': `${begin('version-pin')}bogus${END}\n`,
  });
  const targets = listTargets(root);
  for (const t of ['README.md', 'STACK.md', 'CHANGELOG.md', 'docs/a.md', 'docs/nested/b.md', 'templates/t/README.md']) {
    assert.ok(targets.includes(t), `missing ${t}`);
  }
  assert.ok(!targets.some((t) => t.startsWith('scripts/')), 'scripts must not be scanned');
  rmSync(root, { recursive: true });
});
