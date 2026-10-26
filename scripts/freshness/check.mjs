#!/usr/bin/env node
// Read-only freshness gate: exits 1 when any marked block drifts from the
// source of truth (package.json versions + latest released CHANGELOG section)
// or when markers are malformed. Usage: node scripts/freshness/check.mjs
// [--root <dir>]. Run `node scripts/freshness/sync.mjs` to fix drift.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, parseArgs } from './lib.mjs';

export function main(root) {
  const { drifts, errors, scanned, blocks } = check(root);
  for (const err of errors) console.error(`ERROR ${err}`);
  for (const d of drifts) {
    console.error(`DRIFT ${d.file}:${d.line}: block '${d.name}' is stale`);
    console.error('--- found ---');
    console.error(d.actual.trimEnd() || '(empty)');
    console.error('--- expected ---');
    console.error(d.expected.trimEnd());
  }
  if (errors.length > 0) {
    console.error(`fresh:check: ${errors.length} error(s) across ${scanned} file(s)`);
    return 1;
  }
  if (drifts.length > 0) {
    console.error(`fresh:check: ${drifts.length} stale block(s) across ${scanned} file(s); run fresh:sync`);
    return 1;
  }
  console.log(`fresh:check: ${blocks} block(s) fresh across ${scanned} file(s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), 'check.mjs');
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  if (args.help) {
    console.log('usage: node scripts/freshness/check.mjs [--root <dir>]');
    process.exit(0);
  }
  const root = args.root ? resolve(args.root) : resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  process.exit(main(root));
}
