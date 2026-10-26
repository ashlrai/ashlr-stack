// Source-of-truth freshness for versioned docs. Reads the release version from
// package.json manifests, the CHANGELOG's latest released section, server.json
// and the CLI VERSION constant, then regenerates marked blocks
// (<!-- fresh:begin name --> ... <!-- fresh:end -->) in docs. Shared by
// sync.mjs (writes), check.mjs (read-only gate) and the node:test suite.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

// Files and directories scanned for fresh: markers. Directories are walked
// recursively for *.md files.
export const SCAN_TARGETS = ['README.md', 'STACK.md', 'CHANGELOG.md', 'docs', 'templates'];

const RELEASED_MANIFESTS = [
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/mcp/package.json',
];

const BEGIN_LINE = /^\s*<!--\s*fresh:begin\s+([a-z0-9][a-z0-9-]*)\s*-->\s*$/;
const END_LINE = /^\s*<!--\s*fresh:end\s*-->\s*$/;
const BEGIN_INLINE = /<!--\s*fresh:begin\s+([a-z0-9][a-z0-9-]*)\s*-->/;
const END_INLINE = /<!--\s*fresh:end\s*-->/;
const RELEASE_HEADING = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*\((\d{4}-\d{2}-\d{2})\)/m;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { __error: err.message };
  }
}

// Resolve the release picture for a repo root. Returns { ctx, errors }; when
// errors is non-empty the version cannot be trusted and neither script should
// write or pass.
export function buildContext(root) {
  const errors = [];
  const rootManifest = readJson(join(root, 'package.json'));
  if (rootManifest.__error) errors.push(`package.json: ${rootManifest.__error}`);

  const packages = [];
  for (const manifest of RELEASED_MANIFESTS) {
    const json = readJson(join(root, manifest));
    if (json.__error) {
      errors.push(`${manifest}: ${json.__error}`);
      continue;
    }
    packages.push({ name: json.name, version: json.version, manifest });
  }

  const release = packages.find((p) => p.manifest === 'packages/cli/package.json')?.version;
  for (const p of packages) {
    if (p.version !== release) {
      errors.push(`${p.manifest} is ${p.version}; released packages must share packages/cli/package.json version ${release}`);
    }
  }

  let changelog = null;
  try {
    const changelogText = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    const match = changelogText.match(RELEASE_HEADING);
    if (!match) {
      errors.push('CHANGELOG.md has no released "## x.y.z (date)" section');
    } else {
      changelog = { version: match[1], date: match[2], heading: `${match[1]} (${match[2]})` };
      if (release && match[1] !== release) {
        errors.push(`latest released CHANGELOG.md section is ${match[1]} but packages/cli/package.json is ${release}`);
      }
    }
  } catch (err) {
    errors.push(`CHANGELOG.md: ${err.message}`);
  }

  const extraVersions = [];
  const serverJson = readJson(join(root, 'packages/mcp/server.json'));
  if (serverJson.__error) {
    errors.push(`packages/mcp/server.json: ${serverJson.__error}`);
  } else {
    extraVersions.push(['packages/mcp/server.json', serverJson.version]);
    for (const pkg of serverJson.packages ?? []) {
      extraVersions.push([`packages/mcp/server.json packages.${pkg.identifier ?? '?'}`, pkg.version]);
    }
  }
  try {
    const cliSource = readFileSync(join(root, 'packages/cli/src/index.ts'), 'utf8');
    const versionMatch = cliSource.match(/^const VERSION = "([^"]+)";/m);
    if (!versionMatch) {
      errors.push('packages/cli/src/index.ts: no const VERSION = "x.y.z" found');
    } else {
      extraVersions.push(['packages/cli/src/index.ts VERSION', versionMatch[1]]);
    }
  } catch (err) {
    errors.push(`packages/cli/src/index.ts: ${err.message}`);
  }
  for (const [label, version] of extraVersions) {
    if (release && version !== release) {
      errors.push(`${label} is ${version}; expected ${release}`);
    }
  }

  const ctx = {
    root,
    release,
    changelog,
    monorepo: { name: rootManifest.name, version: rootManifest.version, private: rootManifest.private === true },
    packages,
  };
  return { ctx, errors };
}

// All markdown files under the scan targets, sorted, relative to root.
export function listTargets(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.md')) files.push(p);
    }
  };
  for (const target of SCAN_TARGETS) {
    const p = join(root, target);
    try {
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) files.push(p);
    } catch {
      // A missing target is fine: scan sets are a ceiling, not a requirement.
    }
  }
  const seen = new Set();
  return files
    .map((p) => relative(root, p).split(sep).join('/'))
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .sort();
}

// Parse fresh: marker pairs out of markdown text. Returns { blocks, errors }.
// Each block: { name, inline, file, inner, contentStart, contentEnd, line }.
// Offsets are into text; `inner` is the current body between the markers.
export function parseBlocks(text, file) {
  const blocks = [];
  const errors = [];
  const lines = text.split('\n');
  let offset = 0;
  let open = null; // { name, line, contentStart }
  let fence = null; // '`' or '~' while inside a fenced code block
  lines.forEach((line, i) => {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1; // past '\n'
    const lineNo = i + 1;
    // A fence marker inside an open fresh: block is block content, not syntax.
    const fenceMatch = open ? null : line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (fence === ch) fence = null;
      else if (fence === null) fence = ch;
    }
    if (fence) return;

    if (open) {
      if (BEGIN_LINE.test(line) || BEGIN_INLINE.test(line)) {
        errors.push(`${file}:${lineNo}: nested fresh:begin inside '${open.name}' (opened line ${open.line})`);
      } else if (END_LINE.test(line)) {
        blocks.push({
          name: open.name,
          inline: false,
          file,
          line: open.line,
          inner: text.slice(open.contentStart, lineStart),
          contentStart: open.contentStart,
          contentEnd: lineStart,
        });
        open = null;
      }
      return;
    }

    const beginLine = line.match(BEGIN_LINE);
    if (beginLine) {
      open = { name: beginLine[1], line: lineNo, contentStart: lineEnd + 1 };
      return;
    }
    const endAlone = END_LINE.test(line);
    const beginInline = line.match(BEGIN_INLINE);
    if (endAlone && !beginInline) {
      errors.push(`${file}:${lineNo}: fresh:end without a matching fresh:begin`);
      return;
    }
    if (!beginInline) {
      if (END_INLINE.test(line)) errors.push(`${file}:${lineNo}: fresh:end without a matching fresh:begin`);
      return;
    }
    const afterBegin = line.slice(beginInline.index + beginInline[0].length);
    const endInline = afterBegin.match(END_INLINE);
    if (!endInline) {
      errors.push(`${file}:${lineNo}: inline fresh:begin '${beginInline[1]}' must close on the same line`);
      return;
    }
    if (BEGIN_INLINE.test(afterBegin.slice(endInline.index + endInline[0].length))) {
      errors.push(`${file}:${lineNo}: second fresh:begin on one line; keep one block per line`);
      return;
    }
    const innerStart = lineStart + beginInline.index + beginInline[0].length;
    const innerEnd = lineStart + beginInline.index + beginInline[0].length + endInline.index;
    blocks.push({
      name: beginInline[1],
      inline: true,
      file,
      line: lineNo,
      inner: text.slice(innerStart, innerEnd),
      contentStart: innerStart,
      contentEnd: innerEnd,
    });
    const rest = afterBegin.slice(endInline.index + endInline[0].length);
    if (END_INLINE.test(rest)) errors.push(`${file}:${lineNo}: extra fresh:end after inline block`);
  });
  if (open) errors.push(`${file}:${open.line}: fresh:begin '${open.name}' never closed with fresh:end`);
  return { blocks, errors };
}

// The generated body for each marker name. `inline: true` means the generator
// emits a single line and may sit inside prose; otherwise the block must use
// begin/end markers on their own lines.
export const GENERATORS = {
  'version-pin': {
    inline: true,
    description: 'bare release version, e.g. 0.2.2',
    generate: (ctx) => ctx.release,
  },
  'version-badge': {
    inline: false,
    description: 'shields badge pinned to the source version, linking to the changelog',
    generate: (ctx, file) => {
      const link = posix.relative(posix.dirname(file), 'CHANGELOG.md');
      const label = `v${ctx.release}`;
      // shields escapes: - becomes --, _ becomes __
      const escaped = label.replace(/-/g, '--').replace(/_/g, '__');
      return `[![source ${label}](https://img.shields.io/badge/source-${escaped}-blue.svg)](${link})`;
    },
  },
  'install-snippet': {
    inline: false,
    description: 'fenced bash install with packages pinned to the release version',
    generate: (ctx) => {
      const name = (manifest) => ctx.packages.find((p) => p.manifest === manifest)?.name;
      const pkgs = [name('packages/cli/package.json'), name('packages/mcp/package.json')]
        .filter(Boolean)
        .map((n) => `${n}@${ctx.release}`)
        .join(' ');
      return ['```bash', `bun add -g ${pkgs}     # or: npm i -g`, '```'].join('\n');
    },
  },
  'version-table': {
    inline: false,
    description: 'markdown table of shipped package versions plus the latest changelog section',
    generate: (ctx) => {
      const rows = ctx.packages.map((p) => `| \`${p.name}\` | \`${p.manifest}\` | ${p.version} |`);
      const root = `| \`${ctx.monorepo.name}\` (private) | \`package.json\` | ${ctx.monorepo.version} |`;
      const released = ctx.changelog ? `\`${ctx.changelog.heading}\`` : 'none';
      return [
        '| Package | Manifest | Version |',
        '| --- | --- | --- |',
        ...rows,
        root,
        '',
        `Latest released CHANGELOG section: ${released}.`,
      ].join('\n');
    },
  },
};

function renderBlock(block, ctx) {
  const gen = GENERATORS[block.name];
  const out = gen.generate(ctx, block.file);
  return block.inline ? out : `${out}\n`;
}

function loadTargets(root) {
  const files = [];
  for (const rel of listTargets(root)) {
    files.push({ rel, text: readFileSync(join(root, rel), 'utf8') });
  }
  return files;
}

// Compare generated blocks against what is on disk. Returns
// { drifts, errors, scanned, blocks } where drifts carry before/after text.
export function check(root) {
  const { ctx, errors } = buildContext(root);
  const drifts = [];
  let scanned = 0;
  let blockCount = 0;
  if (errors.length === 0) {
    for (const { rel, text } of loadTargets(root)) {
      const { blocks, errors: parseErrors } = parseBlocks(text, rel);
      errors.push(...parseErrors);
      scanned += 1;
      for (const block of blocks) {
        blockCount += 1;
        const gen = GENERATORS[block.name];
        if (!gen) {
          errors.push(`${rel}:${block.line}: unknown fresh block '${block.name}'`);
          continue;
        }
        if (!gen.inline && block.inline) {
          errors.push(`${rel}:${block.line}: '${block.name}' needs begin/end markers on their own lines`);
          continue;
        }
        const expected = renderBlock(block, ctx);
        if (block.inline ? block.inner !== expected : block.inner.trimEnd() !== expected.trimEnd()) {
          drifts.push({ file: rel, line: block.line, name: block.name, actual: block.inner, expected });
        }
      }
    }
  }
  return { drifts, errors, scanned, blocks: blockCount };
}

// Rewrite every marked block in place. Returns { changed, errors, scanned, blocks }.
export function sync(root) {
  const { ctx, errors } = buildContext(root);
  const changed = [];
  let scanned = 0;
  let blockCount = 0;
  if (errors.length === 0) {
    for (const { rel, text } of loadTargets(root)) {
      const { blocks, errors: parseErrors } = parseBlocks(text, rel);
      errors.push(...parseErrors);
      scanned += 1;
      let next = text;
      for (const block of [...blocks].reverse()) {
        blockCount += 1;
        const gen = GENERATORS[block.name];
        if (!gen) {
          errors.push(`${rel}:${block.line}: unknown fresh block '${block.name}'`);
          continue;
        }
        if (!gen.inline && block.inline) {
          errors.push(`${rel}:${block.line}: '${block.name}' needs begin/end markers on their own lines`);
          continue;
        }
        const expected = renderBlock(block, ctx);
        const stale = block.inline ? block.inner !== expected : block.inner.trimEnd() !== expected.trimEnd();
        if (stale) {
          next = next.slice(0, block.contentStart) + expected + next.slice(block.contentEnd);
          changed.push({ file: rel, line: block.line, name: block.name });
        }
      }
      if (next !== text) writeFileSync(join(root, rel), next);
    }
  }
  return { changed, errors, scanned, blocks: blockCount };
}

export function parseArgs(argv, script) {
  const args = { root: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) {
      args.root = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      args.help = true;
    } else {
      return { error: `unknown argument: ${argv[i]}\nusage: node scripts/freshness/${script} [--root <dir>]` };
    }
  }
  return args;
}
