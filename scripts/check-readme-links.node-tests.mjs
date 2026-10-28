import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { anchorsOf, checkMarkdown, collectTargets, repository, slugify } from './check-readme-links.mjs';

const README = join(repository, 'README.md');
const CLI = join(repository, 'scripts/check-readme-links.mjs');

test('repository README: every link resolves', async () => {
  assert.deepEqual(await checkMarkdown(README), { failures: [], warnings: [] });
});

test('CLI exits 0 on the repository README', () => {
  const run = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /ok /);
});

test('slugify matches GitHub heading anchors', () => {
  assert.equal(slugify('Try it in 30 seconds'), 'try-it-in-30-seconds');
  assert.equal(slugify('Connect your agent (MCP)'), 'connect-your-agent-mcp');
  assert.equal(slugify('How Stack plugs into Phantom'), 'how-stack-plugs-into-phantom');
  assert.equal(anchorsOf('# A\n# A\n# B!').has('a-1'), true);
});

test('collectTargets covers markdown links, html attrs and fenced bare URLs', () => {
  const md = [
    '[a](./x.md) ![i](./i.png) <img src="./og.svg">',
    '```bash',
    'curl -fsSL https://example.com/install.sh | bash',
    '```',
  ].join('\n');
  const targets = collectTargets(md);
  for (const t of ['./x.md', './i.png', './og.svg', 'https://example.com/install.sh']) {
    assert.ok(targets.includes(t), `missing ${t}`);
  }
});

test('URLs inside inline code spans are values, not links', () => {
  const md = [
    '| `OPENAI_BASE_URL` | `https://api.example.com/v1` | key check |',
    '`[not a link](./inside-code.md)` but [a link](./outside.md)',
  ].join('\n');
  const targets = collectTargets(md);
  assert.ok(!targets.includes('https://api.example.com/v1'));
  assert.ok(!targets.includes('./inside-code.md'));
  assert.ok(targets.includes('./outside.md'));
});

test('missing files, missing anchors and malformed URLs fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stack-links-'));
  try {
    await writeFile(join(dir, 'exists.md'), '# Target\n\n## Section One\n');
    const cases = [
      ['[x](./nope.md)', /missing file/],
      ['[x](#no-such-heading)', /missing anchor #no-such-heading/],
      ['[x](./exists.md#other-section)', /missing anchor #other-section/],
      ['[x](http://[)', /malformed URL/],
      ['<img src="./missing.png">', /missing file/],
    ];
    for (const [line, pattern] of cases) {
      const path = join(dir, 'case.md');
      await writeFile(path, `# Case\n\n${line}\n`);
      const { failures } = await checkMarkdown(path);
      assert.equal(failures.length, 1, `${line}: ${failures}`);
      assert.match(failures[0], pattern);
    }
    // Anchor into a sibling file does resolve.
    const path = join(dir, 'ok.md');
    await writeFile(path, '[x](./exists.md#section-one)\n');
    assert.deepEqual(await checkMarkdown(path), { failures: [], warnings: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI reports each failure and exits 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stack-links-cli-'));
  try {
    const path = join(dir, 'bad.md');
    await writeFile(path, '[x](./nope.md)\n[y](#gone)\n');
    const run = spawnSync(process.execPath, [CLI, path], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /missing file: \.\/nope\.md/);
    assert.match(run.stderr, /missing anchor #gone/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
