import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('MCP registry readiness and publication regression tests', () => {
  const run = spawnSync('node', ['--test', 'scripts/mcp-registry-gate.node-tests.mjs'], {
    encoding: 'utf8',
  });
  expect(run.status, run.stdout + run.stderr).toBe(0);
});
