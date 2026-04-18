#!/usr/bin/env node
/**
 * scripts/inject-client-ids.mjs — stamp Ashlr-registered OAuth client IDs
 * into packages/core/src/env.ts before `npm publish`.
 *
 * Called from .github/workflows/release.yml with OAUTH_SUPABASE_CLIENT_ID +
 * OAUTH_GITHUB_CLIENT_ID set from GitHub Actions secrets. The release
 * workflow `git restore`s env.ts afterward so these values never land in
 * the committed repo — they live only in the published tarball.
 *
 * Safe to run locally:
 *   - Without the env vars: it's a no-op.
 *   - With them set: it edits env.ts in place. Restore with
 *     `git restore packages/core/src/env.ts`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(__dirname, "../packages/core/src/env.ts");

/** Ordered map of env-var → key-in-OAUTH_DEFAULTS. */
const SOURCES = [
  ["OAUTH_SUPABASE_CLIENT_ID", "supabase"],
  ["OAUTH_GITHUB_CLIENT_ID",   "github"],
];

let src;
try {
  src = readFileSync(ENV_FILE, "utf8");
} catch (err) {
  console.error(`  ✗ couldn't read ${ENV_FILE}:`, err.message);
  process.exit(1);
}

let injected = 0;
for (const [envVar, key] of SOURCES) {
  const value = process.env[envVar];
  if (!value) continue;
  if (!/^[A-Za-z0-9_.\-~]+$/.test(value)) {
    console.error(`  ✗ ${envVar} contains unexpected characters — refusing to inject.`);
    process.exit(1);
  }

  // Match: `  supabase: "",` or `  supabase: "abc",`
  const re = new RegExp(`(^\\s*${key}:\\s*)"[^"]*"`, "m");
  const next = src.replace(re, `$1"${value}"`);
  if (next === src) {
    console.warn(`  ! couldn't find "${key}:" slot in env.ts — skipped.`);
    continue;
  }
  src = next;
  injected++;
  console.log(`  ✓ injected ${key} client id`);
}

if (injected > 0) {
  writeFileSync(ENV_FILE, src);
  console.log(`  env.ts updated in place (${injected} values).`);
} else {
  console.log("  no OAUTH_*_CLIENT_ID env vars set — nothing to inject.");
}
