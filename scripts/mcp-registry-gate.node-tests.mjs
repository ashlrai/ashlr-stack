import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkAssets,
  checkNpm,
  checkReleaseJobs,
  checkReleaseRuns,
  deepCanonicalEqual,
  publishOnce,
  readiness,
  registryDecision,
  validateContext,
} from './mcp-registry-gate.mjs';

const tag = 'v0.3.1';
const sha = 'a'.repeat(40);
const manifest = {
  name: 'ashlr-stack-mcp',
  version: '0.3.1',
  mcpName: 'io.github.ashlrai/ashlr-stack',
};
const descriptor = {
  name: manifest.mcpName,
  version: manifest.version,
  packages: [
    {
      registryType: 'npm',
      identifier: manifest.name,
      version: manifest.version,
      transport: { type: 'stdio' },
    },
  ],
};
const context = () => ({
  ref: `refs/tags/${tag}`,
  tag,
  sha,
  descriptor: structuredClone(descriptor),
  manifest: { ...manifest },
});
const run = (overrides = {}) => ({
  event: 'push',
  head_branch: tag,
  head_sha: sha,
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});
const runs = (...workflow_runs) => ({ total_count: workflow_runs.length, workflow_runs });
const assetNames = [
  'stack-linux-x64',
  'stack-linux-arm64',
  'stack-darwin-x64',
  'stack-darwin-arm64',
].flatMap((name) => [name, `${name}.sha256`]);
const release = () => ({
  tag_name: tag,
  draft: false,
  assets: assetNames.map((name) => ({ name, state: 'uploaded' })),
});
const active = (server = structuredClone(descriptor), status = 'active') => ({
  server,
  _meta: { 'io.modelcontextprotocol.registry/official': { status } },
});

test('context binds exact tag, commit, descriptor and local npm manifest', () => {
  assert.doesNotThrow(() => validateContext(context()));
  for (const mutation of [
    (c) => {
      c.ref = 'refs/heads/main';
    },
    (c) => {
      c.tag = 'v0.3.2';
    },
    (c) => {
      c.sha = 'a'.repeat(39);
    },
    (c) => {
      c.sha = 'z'.repeat(40);
    },
    (c) => {
      c.descriptor.version = '0.3.0';
    },
    (c) => {
      c.manifest.version = '0.3.0';
    },
    (c) => {
      c.manifest.mcpName = 'io.github.other/other';
    },
    (c) => {
      c.descriptor.packages[0].identifier = 'different';
    },
    (c) => {
      c.descriptor.packages[0].version = '0.3.0';
    },
    (c) => {
      c.descriptor.packages.push({ ...c.descriptor.packages[0] });
    },
  ]) {
    const c = context();
    mutation(c);
    assert.throws(() => validateContext(c));
  }
});

test('readiness requires a completed successful push run for the exact tag and SHA', () => {
  assert.equal(checkReleaseRuns(runs(), tag, sha), false);
  assert.equal(
    checkReleaseRuns(runs(run({ status: 'in_progress', conclusion: null })), tag, sha),
    false,
  );
  assert.equal(checkReleaseRuns(runs(run({ conclusion: 'failure' })), tag, sha), false);
  assert.equal(checkReleaseRuns(runs(run({ head_branch: 'v0.3.0' })), tag, sha), false);
  assert.equal(checkReleaseRuns(runs(run({ head_sha: 'b'.repeat(40) })), tag, sha), false);
  assert.equal(checkReleaseRuns(runs(run({ event: 'workflow_dispatch' })), tag, sha), false);
  assert.equal(checkReleaseRuns(runs(run({ conclusion: 'failure' }), run()), tag, sha), true);
  assert.throws(() => checkReleaseRuns({ total_count: 2, workflow_runs: [run()] }, tag, sha));
  assert.throws(() => checkReleaseRuns({ total_count: 1, workflow_runs: null }, tag, sha));
});

test('successful release run has each exact required producer job, with no skips or duplicates', () => {
  const names = [
    'Full suite green on release sha',
    'Build stack-linux-x64',
    'Build stack-linux-arm64',
    'Build stack-darwin-x64',
    'Build stack-darwin-arm64',
    'Publish to npm',
    'Smoke stack-darwin-arm64 natively',
    'Create GitHub Release',
  ];
  const complete = () => ({
    total_count: names.length,
    jobs: names.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  });
  assert.equal(checkReleaseJobs(complete()), true);
  let r = complete();
  r.jobs.pop();
  r.total_count--;
  assert.equal(checkReleaseJobs(r), false);
  r = complete();
  r.jobs[0].status = 'in_progress';
  r.jobs[0].conclusion = null;
  assert.equal(checkReleaseJobs(r), false);
  r = complete();
  r.jobs[1].conclusion = 'skipped';
  assert.equal(checkReleaseJobs(r), false);
  r = complete();
  r.jobs[2].conclusion = 'failure';
  assert.equal(checkReleaseJobs(r), false);
  r = complete();
  r.jobs.push({ ...r.jobs[0] });
  r.total_count++;
  assert.equal(checkReleaseJobs(r), false);
  r = complete();
  r.total_count++;
  assert.throws(() => checkReleaseJobs(r));
  assert.throws(() => checkReleaseJobs({ total_count: 0, jobs: null }));
});

test('all eight uniquely uploaded assets on the exact non-draft release are required', () => {
  assert.equal(checkAssets(release(), tag), true);
  let r = release();
  r.assets.pop();
  assert.equal(checkAssets(r, tag), false);
  r = release();
  r.assets[0].state = 'new';
  assert.equal(checkAssets(r, tag), false);
  r = release();
  r.assets.push({ ...r.assets[0] });
  assert.equal(checkAssets(r, tag), false);
  r = release();
  r.draft = true;
  assert.throws(() => checkAssets(r, tag));
  r = release();
  r.tag_name = 'v0.3.0';
  assert.throws(() => checkAssets(r, tag));
  r = release();
  r.assets = null;
  assert.throws(() => checkAssets(r, tag));
});

test('published npm metadata must match exact descriptor identity', () => {
  assert.equal(checkNpm({ ...manifest }, descriptor, manifest), true);
  for (const published of [
    null,
    { ...manifest, name: 'other' },
    { ...manifest, version: '0.3.0' },
    { ...manifest, mcpName: 'io.github.other/other' },
    { name: manifest.name, version: manifest.version },
  ])
    assert.throws(() => checkNpm(published, descriptor, manifest));
});

test('registry checks absent, identical active, conflict, deletion and error states', () => {
  assert.equal(
    registryDecision(
      404,
      { title: 'Not Found', status: 404, detail: 'Server not found' },
      descriptor,
    ),
    'publish',
  );
  assert.equal(registryDecision(200, active(), descriptor), 'already');
  assert.throws(() =>
    registryDecision(200, active({ ...descriptor, version: '0.3.0' }), descriptor),
  );
  assert.throws(() => registryDecision(200, active(descriptor, 'deleted'), descriptor));
  assert.throws(() => registryDecision(200, { server: descriptor }, descriptor));
  assert.throws(() => registryDecision(404, null, descriptor));
  assert.throws(() =>
    registryDecision(
      404,
      { title: 'Not Found', status: 404, detail: 'wrong endpoint' },
      descriptor,
    ),
  );
  assert.throws(() => registryDecision(403, null, descriptor));
  assert.throws(() => registryDecision(500, null, descriptor));
});

test('canonical comparison ignores object key order but preserves arrays and exact fields', () => {
  assert.equal(
    deepCanonicalEqual({ a: 1, b: { x: [1, 2], y: true } }, { b: { y: true, x: [1, 2] }, a: 1 }),
    true,
  );
  assert.equal(deepCanonicalEqual({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(deepCanonicalEqual({ a: 1 }, { a: 1, b: null }), false);
  assert.equal(deepCanonicalEqual([1], { 0: 1 }), false);
});

test('one publish attempt reconciles races without retrying writes', async () => {
  let writes = 0;
  await publishOnce(
    async () => 'already',
    () => {
      writes++;
      return 0;
    },
  );
  assert.equal(writes, 0);
  writes = 0;
  let successfulChecks = 0;
  await publishOnce(
    async () => (++successfulChecks === 1 ? 'publish' : 'already'),
    () => {
      writes++;
      return 0;
    },
  );
  assert.equal(writes, 1);
  writes = 0;
  let checks = 0;
  await publishOnce(
    async () => (++checks === 1 ? 'publish' : 'already'),
    () => {
      writes++;
      return 1;
    },
  );
  assert.equal(checks, 2);
  assert.equal(writes, 1);
  writes = 0;
  checks = 0;
  await assert.rejects(() =>
    publishOnce(
      async () => {
        checks++;
        return 'publish';
      },
      () => {
        writes++;
        return 1;
      },
    ),
  );
  assert.equal(checks, 2);
  assert.equal(writes, 1);
  writes = 0;
  checks = 0;
  await assert.rejects(() =>
    publishOnce(
      async () => {
        if (++checks === 1) return 'publish';
        throw new Error('conflict');
      },
      () => {
        writes++;
        return 1;
      },
    ),
  );
  assert.equal(checks, 2);
  assert.equal(writes, 1);
});

test('readiness checks terminal exact run once; pending and failed runs fail immediately', async () => {
  const names = [
    'Full suite green on release sha',
    'Build stack-linux-x64',
    'Build stack-linux-arm64',
    'Build stack-darwin-x64',
    'Build stack-darwin-arm64',
    'Publish to npm',
    'Smoke stack-darwin-arm64 natively',
    'Create GitHub Release',
  ];
  const requested = [];
  const get = async (url) => {
    requested.push(url);
    if (url.includes('/workflows/'))
      return { status: 200, body: runs(run({ id: 12, run_attempt: 2 })) };
    if (url.includes('/attempts/2/jobs'))
      return {
        status: 200,
        body: {
          total_count: names.length,
          jobs: names.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
        },
      };
    if (url.includes('/releases/tags/')) return { status: 200, body: release() };
    if (url.startsWith('https://registry.npmjs.org/')) return { status: 200, body: manifest };
    throw new Error(`unexpected URL ${url}`);
  };
  const ctx = { tag, sha, descriptor, manifest, repo: 'ashlrai/ashlr-stack' };
  await readiness(ctx, { get });
  assert.equal(requested.filter((url) => url.includes('/workflows/')).length, 1);
  assert.ok(requested.some((url) => url.includes('/runs/12/attempts/2/jobs')));
  assert.ok(requested[0].includes('branch=v0.3.1') && requested[0].includes(`head_sha=${sha}`));
  for (const pending of [
    run({ status: 'in_progress', conclusion: null }),
    run({ conclusion: 'failure' }),
  ]) {
    let count = 0;
    await assert.rejects(
      () =>
        readiness(ctx, {
          get: async () => {
            count++;
            return { status: 200, body: runs(pending) };
          },
        }),
      /no completed successful exact-tag/,
    );
    assert.equal(count, 1);
  }
});

test('workflow skips prerelease events and only dispatches exact-tag gate manually', () => {
  const workflow = readFileSync('.github/workflows/mcp-registry.yml', 'utf8');
  assert.match(
    workflow,
    /if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'release' && toJSON\(github\.event\.release\.prerelease\) == 'false'\)/,
  );
  assert.match(workflow, /ref: \${{ github\.ref }}/);
  assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /node scripts\/mcp-registry-gate\.mjs prepare/);
  assert.match(workflow, /node scripts\/mcp-registry-gate\.mjs publish/);
});
