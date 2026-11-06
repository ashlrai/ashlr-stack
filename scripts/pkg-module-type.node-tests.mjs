import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = join(root, 'packages');

function assertModule(manifest) {
  const packageJson = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(packageJson.type, 'module', `${manifest} must declare type: module`);
}

test('root package uses ES modules', () => {
  assertModule(join(root, 'package.json'));
});

for (const entry of readdirSync(packages, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = join(packages, entry.name, 'package.json');
  if (!existsSync(manifest)) continue;

  test(`${entry.name} package uses ES modules`, () => {
    assertModule(manifest);
  });
}
