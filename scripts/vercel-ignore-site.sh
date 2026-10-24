#!/bin/sh
# Vercel "Ignored Build Step" for packages/site (Vercel runs it from there).
# Exit 0 skips the build, exit 1 builds. Vercel treats any other exit code as
# a failed deployment, so every outcome is folded into 0 or 1: skip only when
# Vercel names the last deployed commit, this clone has it, and nothing the
# site build reads has changed since.
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$prev" ] || exit 1
cd "$(dirname "$0")/.." || exit 1
if git diff --quiet "$prev" HEAD -- packages/site packages/core packages/cli packages/mcp \
  CHANGELOG.md scripts/install.sh scripts/install.ps1 scripts/sync-phantom-brand.sh \
  scripts/vercel-ignore-site.sh package.json bun.lock 2>/dev/null; then
  echo "site inputs unchanged since $prev; skipping build"
  exit 0
fi
exit 1
