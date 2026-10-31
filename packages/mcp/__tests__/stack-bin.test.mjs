import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliBinFromPackageJson, resolveStackCommand } from '../src/stack-bin.ts';

function fixture(t, bin = 'dist/index.js') {
  const root = mkdtempSync(join(tmpdir(), 'stack-bin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, 'package.json');
  writeFileSync(pkg, JSON.stringify({ bin: { stack: bin } }));
  mkdirSync(join(root, 'dist'));
  return { root, pkg, bin: join(root, bin) };
}

test('directory named as CLI binary does not hide PATH fallback', t => {
  const f = fixture(t);
  mkdirSync(f.bin);
  assert.equal(cliBinFromPackageJson(f.pkg), undefined);
  assert.deepEqual(resolveStackCommand({}, () => f.pkg), {
    command: 'stack', prefixArgs: [], source: 'path',
  });
});

test('regular script stays runnable through current runtime', t => {
  const f = fixture(t);
  writeFileSync(f.bin, 'console.log("fixture")');
  assert.equal(cliBinFromPackageJson(f.pkg), f.bin);
  assert.deepEqual(resolveStackCommand({}, () => f.pkg), {
    command: process.execPath, prefixArgs: [f.bin], source: 'package',
  });
});

test('missing binary falls back and explicit override still wins', t => {
  const f = fixture(t);
  assert.equal(cliBinFromPackageJson(f.pkg), undefined);
  assert.deepEqual(resolveStackCommand({ STACK_BIN: 'explicit-stack' }, () => f.pkg), {
    command: 'explicit-stack', prefixArgs: [], source: 'env',
  });
});

test('symlinked regular script remains supported', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const target = join(f.root, 'actual.js');
  writeFileSync(target, '');
  symlinkSync(target, f.bin);
  assert.equal(cliBinFromPackageJson(f.pkg), f.bin);
});
