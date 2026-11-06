import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliBinFromPackageJson, resolveStackCommand } from '../src/stack-bin.ts';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(bin = 'dist/index.js') {
  const root = mkdtempSync(join(tmpdir(), 'stack-bin-'));
  roots.push(root);
  const pkg = join(root, 'package.json');
  writeFileSync(pkg, JSON.stringify({ bin: { stack: bin } }));
  mkdirSync(join(root, 'dist'));
  return { root, pkg, bin: join(root, bin) };
}

test('directory named as CLI binary does not hide PATH fallback', () => {
  const f = fixture();
  mkdirSync(f.bin);
  assert.equal(cliBinFromPackageJson(f.pkg), undefined);
  assert.deepEqual(resolveStackCommand({}, () => f.pkg), {
    command: 'stack', prefixArgs: [], source: 'path',
  });
});

test('regular script stays runnable through current runtime', () => {
  const f = fixture();
  writeFileSync(f.bin, 'console.log("fixture")');
  assert.equal(cliBinFromPackageJson(f.pkg), f.bin);
  assert.deepEqual(resolveStackCommand({}, () => f.pkg), {
    command: process.execPath, prefixArgs: [f.bin], source: 'package',
  });
});

test('missing binary falls back and explicit override still wins', () => {
  const f = fixture();
  assert.equal(cliBinFromPackageJson(f.pkg), undefined);
  assert.deepEqual(resolveStackCommand({ STACK_BIN: 'explicit-stack' }, () => f.pkg), {
    command: 'explicit-stack', prefixArgs: [], source: 'env',
  });
});

test.skipIf(process.platform === 'win32')('symlinked regular script remains supported', () => {
  const f = fixture();
  const target = join(f.root, 'actual.js');
  writeFileSync(target, '');
  symlinkSync(target, f.bin);
  assert.equal(cliBinFromPackageJson(f.pkg), f.bin);
});
