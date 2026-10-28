#!/usr/bin/env node
// check-readme-links.mjs — verify every link in a markdown file resolves.
//
// Offline by default. Extracts markdown links and images, HTML src/href
// attributes, and bare http(s) URLs (including inside fenced code blocks,
// where install snippets live):
//
//   - relative destinations must exist on disk next to the markdown file
//   - #anchor fragments must match a heading in the target file (GitHub slugs)
//   - http(s) URLs must be syntactically valid
//
// Pass --external to also HEAD-request every http(s) URL found. Loopback and
// RFC-1918 hosts are never requested (they are examples, not links).
//
//   node scripts/check-readme-links.mjs [file ...] [--external]
//
// Default file: README.md at the repository root. Exit 0 when everything
// resolves; exit 1 prints one line per failure.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repository = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

// GitHub heading slug: lowercase, strip everything that is not a unicode
// letter, number, space, underscore or hyphen, then spaces to hyphens.
// Repeated headings get -1, -2, ... suffixes.
export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

function headingText(raw) {
  return raw
    .replace(/<[^>]+>/g, '') // inline html
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .trim();
}

// Every resolvable anchor in a document, including dedup suffixes.
export function anchorsOf(markdown) {
  const anchors = new Set();
  const counts = new Map();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const base = slugify(headingText(m[1]));
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const FENCE = /^\s*(```|~~~)/;
const MD_LINK = /!?\[[^\]]*\]\(\s*([^)\s]+?)(?:\s+"[^"]*")?\s*\)/g;
const HTML_ATTR = /\b(?:src|href)="([^"]+)"/g;
const BARE_URL = /https?:\/\/[^\s"'`)>\]]+/g;

const LOOPBACK = /^(127\.|0\.|localhost$|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Inline code spans render literally — a URL inside backticks (like an API
// base-URL default in a table) is a value, not a link. Strip them so the
// extractors only see link-bearing text.
const INLINE_CODE = /`+[^`]*`+/g;

function* fragments(markdown) {
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const text = inFence ? line : line.replace(INLINE_CODE, '');
    if (!inFence) {
      for (const m of text.matchAll(MD_LINK)) yield { url: m[1], kind: 'link' };
      for (const m of text.matchAll(HTML_ATTR)) yield { url: m[1], kind: 'html' };
    }
    for (const m of text.matchAll(BARE_URL)) yield { url: m[0], kind: 'bare' };
  }
}

export function collectTargets(markdown) {
  const targets = [];
  const seen = new Set();
  for (const { url } of fragments(markdown)) {
    const clean = url.replace(/[.,;:]+$/, ''); // trailing prose punctuation
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    targets.push(clean);
  }
  return targets;
}

async function checkExternal(url) {
  const host = new URL(url).hostname;
  if (LOOPBACK.test(host)) return null;
  const headers = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) stack-link-check/1.0' };
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (res.status < 400) return null;
      if (res.status === 405 || res.status === 501) continue;
      // 401/403 usually means bot management (npmjs, github rate limits), not a
      // dead link — report a warning instead of failing.
      if (res.status === 401 || res.status === 403) return `warn:${res.status}`;
      return `${res.status}`;
    } catch (error) {
      if (method === 'GET') return error.message;
    }
  }
  return 'unreachable';
}

export async function checkMarkdown(path, { external = false } = {}) {
  const markdown = await readFile(path, 'utf8');
  const dir = dirname(path);
  const ownAnchors = anchorsOf(markdown);
  const failures = [];
  const remote = new Set();

  for (const target of collectTargets(markdown)) {
    if (/^https?:\/\//.test(target)) {
      try {
        new URL(target);
      } catch {
        failures.push(`malformed URL: ${target}`);
        continue;
      }
      if (external) remote.add(target);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // mailto:, tel:, phm:, …

    const [file, anchor] = target.split('#', 2);
    if (file === '') {
      if (anchor && !ownAnchors.has(decode(anchor))) {
        failures.push(`missing anchor #${anchor} in ${path}`);
      }
      continue;
    }
    const resolved = resolve(dir, decode(file));
    if (!existsSync(resolved)) {
      failures.push(`missing file: ${target}`);
      continue;
    }
    if (anchor && /\.md$/i.test(file)) {
      const anchors = anchorsOf(await readFile(resolved, 'utf8'));
      if (!anchors.has(decode(anchor))) {
        failures.push(`missing anchor #${anchor} in ${target}`);
      }
    }
  }

  const warnings = [];
  if (external) {
    const results = await Promise.all([...remote].map(async url => [url, await checkExternal(url)]));
    for (const [url, why] of results) {
      if (!why) continue;
      if (why.startsWith('warn:')) warnings.push(`bot-blocked (${why.slice(5)}): ${url}`);
      else failures.push(`unreachable (${why}): ${url}`);
    }
  }
  return { failures, warnings };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const external = args.includes('--external');
  const files = args.filter(a => a !== '--external');
  const targets = files.length ? files.map(f => resolve(f)) : [resolve(repository, 'README.md')];
  let failed = 0;
  for (const file of targets) {
    const { failures, warnings } = await checkMarkdown(file, { external });
    for (const w of warnings) console.log(`warn ${file}: ${w}`);
    if (failures.length === 0) {
      console.log(`ok ${file}`);
      continue;
    }
    failed = 1;
    for (const f of failures) console.error(`FAIL ${file}: ${f}`);
  }
  process.exitCode = failed;
}
