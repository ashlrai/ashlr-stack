#!/usr/bin/env node
// Regenerate every <!-- fresh:begin name --> ... <!-- fresh:end --> block from
// the source of truth (package.json versions + latest released CHANGELOG
// section) and write the files in place. Usage: node scripts/freshness/sync.mjs
// [--root <dir>]. Check the result with `git diff` and `fresh:check`.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, sync } from './lib.mjs';

export function main(root) {
  const { changed, errors, scanned, blocks } = sync(root);
  for (const err of errors) console.error(`ERROR ${err}`);
  for (const c of changed) console.log(`synced ${c.file}:${c.line}: block '${c.name}'`);
  if (errors.length > 0) {
    console.error(`fresh:sync: ${errors.length} error(s) across ${scanned} file(s)`);
    return 1;
  }
  console.log(`fresh:sync: ${changed.length} block(s) updated, ${blocks} scanned across ${scanned} file(s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), 'sync.mjs');
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  if (args.help) {
    console.log('usage: node scripts/freshness/sync.mjs [--root <dir>]');
    process.exit(0);
  }
  const root = args.root ? resolve(args.root) : resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  process.exit(main(root));
}
