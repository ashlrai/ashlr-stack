import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const tagPattern = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const registryMeta = 'io.modelcontextprotocol.registry/official';
const assets = [
  'stack-linux-x64',
  'stack-linux-arm64',
  'stack-darwin-x64',
  'stack-darwin-arm64',
].flatMap((n) => [n, `${n}.sha256`]);
const fail = (message) => {
  throw new Error(message);
};

export function deepCanonicalEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => deepCanonicalEqual(v, b[i]))
    );
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    return (
      ak.length === bk.length && ak.every((k, i) => k === bk[i] && deepCanonicalEqual(a[k], b[k]))
    );
  }
  return a === b;
}

export function validateContext({ ref, tag, sha, descriptor, manifest }) {
  if (
    !tagPattern.test(tag || '') ||
    ref !== `refs/tags/${tag}` ||
    !/^[0-9a-f]{40}$/.test(sha || '')
  )
    fail('select an exact version tag and commit');
  const version = tag.slice(1);
  if (
    !descriptor ||
    !manifest ||
    descriptor.version !== version ||
    manifest.version !== version ||
    descriptor.name !== manifest.mcpName ||
    !manifest.name
  )
    fail('tag, descriptor and npm manifest disagree');
  const packages = descriptor.packages;
  if (
    !Array.isArray(packages) ||
    packages.length !== 1 ||
    packages[0].registryType !== 'npm' ||
    packages[0].identifier !== manifest.name ||
    packages[0].version !== version
  )
    fail('invalid descriptor npm package');
}

export function checkReleaseRuns(result, tag, sha) {
  if (
    !result ||
    !Array.isArray(result.workflow_runs) ||
    !Number.isInteger(result.total_count) ||
    result.total_count !== result.workflow_runs.length
  )
    fail('invalid or truncated release run response');
  return result.workflow_runs.some(
    (r) =>
      r.event === 'push' &&
      r.head_branch === tag &&
      r.head_sha === sha &&
      r.status === 'completed' &&
      r.conclusion === 'success',
  );
}
export function checkReleaseJobs(result) {
  if (
    !result ||
    !Array.isArray(result.jobs) ||
    !Number.isInteger(result.total_count) ||
    result.total_count !== result.jobs.length
  )
    fail('invalid or truncated release jobs response');
  const required = [
    'Full suite green on release sha',
    ...assets.filter((name) => !name.endsWith('.sha256')).map((name) => `Build ${name}`),
    'Publish to npm',
    'Smoke stack-darwin-arm64 natively',
    'Create GitHub Release',
  ];
  return required.every((name) => {
    const matches = result.jobs.filter((job) => job.name === name);
    return (
      matches.length === 1 &&
      matches[0].status === 'completed' &&
      matches[0].conclusion === 'success'
    );
  });
}
export async function publishOnce(getDecision, execute) {
  const initial = await getDecision();
  if (initial === 'already') return;
  if (initial !== 'publish') fail('invalid registry decision');
  execute(); // Never retry a write, regardless of its exit status.
  if ((await getDecision()) === 'already') return;
  fail('publication is not confirmed by an exact active registry record');
}
export function checkAssets(release, tag) {
  if (
    !release ||
    release.tag_name !== tag ||
    release.draft !== false ||
    !Array.isArray(release.assets)
  )
    fail('invalid release response');
  return assets.every((name) => {
    const matches = release.assets.filter((a) => a.name === name);
    return matches.length === 1 && matches[0].state === 'uploaded';
  });
}
export function checkNpm(published, descriptor, manifest) {
  if (
    !published ||
    published.name !== manifest.name ||
    published.version !== descriptor.version ||
    published.mcpName !== descriptor.name
  )
    fail('published npm identity differs from descriptor');
  return true;
}
export function registryDecision(status, body, descriptor) {
  if (
    status === 404 &&
    body?.title === 'Not Found' &&
    body?.status === 404 &&
    body?.detail === 'Server not found'
  )
    return 'publish';
  if (
    status !== 200 ||
    !body ||
    body?._meta?.[registryMeta]?.status !== 'active' ||
    !deepCanonicalEqual(body.server, descriptor)
  )
    fail('registry response is unavailable, inactive or conflicts with descriptor');
  return 'already';
}

async function json(url, { registry404 = false } = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ashlr-stack-registry-gate' },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404) {
    if (!registry404) return { status: 404, body: null };
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/problem+json'))
      fail('unverified registry 404 response');
    return { status: 404, body: await response.json() };
  }
  if (!response.ok) fail(`GET ${new URL(url).host} returned ${response.status}`);
  return { status: response.status, body: await response.json() };
}
function verifyRemoteTag(tag, sha) {
  const out = execFileSync(
    'git',
    ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    { encoding: 'utf8', timeout: 30000 },
  );
  const refs = new Map(
    out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/).reverse()),
  );
  if ((refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`)) !== sha)
    fail('remote tag moved or is missing');
}
async function registry(descriptor) {
  const url = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(descriptor.name)}/versions/${encodeURIComponent(descriptor.version)}?include_deleted=true`;
  const { status, body } = await json(url, { registry404: true });
  return registryDecision(status, body, descriptor);
}
export async function readiness({ tag, sha, descriptor, manifest, repo }, { get = json } = {}) {
  const query = new URLSearchParams({ event: 'push', branch: tag, head_sha: sha, per_page: '100' });
  const base = `https://api.github.com/repos/${repo}`;
  const runs = await get(`${base}/actions/workflows/release.yml/runs?${query}`);
  if (runs.status !== 200) fail('release workflow runs unavailable');
  if (!checkReleaseRuns(runs.body, tag, sha))
    fail('no completed successful exact-tag release workflow; retry after it completes');
  const successful = runs.body.workflow_runs.filter(
    (r) =>
      r.event === 'push' &&
      r.head_branch === tag &&
      r.head_sha === sha &&
      r.status === 'completed' &&
      r.conclusion === 'success',
  );
  let producersReady = false;
  for (const run of successful) {
    if (
      !Number.isSafeInteger(run.id) ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1
    )
      fail('invalid successful run identity');
    const jobs = await get(
      `${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    );
    if (jobs.status !== 200) fail('release job evidence unavailable');
    if (checkReleaseJobs(jobs.body)) {
      producersReady = true;
      break;
    }
  }
  if (!producersReady) fail('successful release run lacks required successful producer jobs');
  const release = await get(`${base}/releases/tags/${encodeURIComponent(tag)}`);
  const npm = await get(
    `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(descriptor.version)}`,
  );
  if (release.status !== 200 || !checkAssets(release.body, tag) || npm.status !== 200)
    fail('release assets or exact npm version unavailable');
  checkNpm(npm.body, descriptor, manifest);
}

async function main() {
  const mode = process.argv[2];
  if (!['prepare', 'publish'].includes(mode)) fail('invalid mode');
  const ref = process.env.GITHUB_REF || '';
  const tag = ref.startsWith('refs/tags/') ? ref.slice(10) : '';
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const descriptor = JSON.parse(readFileSync('packages/mcp/server.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('packages/mcp/package.json', 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || sha !== process.env.GITHUB_SHA)
    fail('repository or checkout SHA mismatch');
  validateContext({ ref, tag, sha, descriptor, manifest });
  verifyRemoteTag(tag, sha);
  await readiness({ tag, sha, descriptor, manifest, repo });
  verifyRemoteTag(tag, sha);
  const decision = await registry(descriptor);
  if (mode === 'prepare') {
    appendFileSync(process.env.GITHUB_OUTPUT, `action=${decision}\n`);
    console.log(`Registry gate: ${decision}`);
    return;
  }
  // Re-read before the only write; reconcile an ambiguous failure, never retry.
  await publishOnce(
    () => registry(descriptor),
    () =>
      spawnSync(`${process.cwd()}/mcp-publisher`, ['publish'], {
        cwd: 'packages/mcp',
        stdio: 'inherit',
      }).status,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((err) => {
    console.error(`::error::MCP registry gate: ${err.message}`);
    process.exitCode = 1;
  });
