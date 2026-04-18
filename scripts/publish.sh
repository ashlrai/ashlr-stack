#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/publish.sh — Ashlr Stack npm publish dance.
#
# Run this when Mason is ready to publish v0.1 (or any subsequent version).
#
# What it does, in order:
#
#   1. Bumps the `version` field in each published package.json to <version>
#      (core, mcp, cli). Takes `--version X.Y.Z` or prompts.
#   2. Rewrites `workspace:*` deps to `^X.Y.Z` so they resolve on a plain
#      `npm install` outside the monorepo. Backs up originals to
#      package.json.bak before touching anything.
#   3. Runs `npm publish --dry-run` for each package in dep order so you can
#      eyeball what would ship.
#   4. Prompts for confirmation. Only on explicit "yes" does it run the real
#      `npm publish` (core → mcp → cli).
#   5. ALWAYS restores the `workspace:*` entries (even on failure via trap)
#      so local dev with `bun install` keeps working.
#   6. On success, tags the release `v<version>` and pushes the tag.
#
# The script NEVER publishes without that explicit prompt — dry-run is the
# default behaviour.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Order matters: core is a dep of cli (and transitively of mcp consumers).
PKG_ORDER=(
  "packages/core"
  "packages/mcp"
  "packages/cli"
)

# ---- helpers --------------------------------------------------------------

say()  { printf "  \033[1;35m->\033[0m publish: %s\n" "$1"; }
warn() { printf "  \033[1;33m!\033[0m  publish: %s\n" "$1" >&2; }
die()  { printf "  \033[1;31mx\033[0m  publish: %s\n" "$1" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: scripts/publish.sh [--version <X.Y.Z>] [--yes]

  --version X.Y.Z   Version to publish. If omitted, prompts interactively.
  --yes             Skip the final "really publish?" prompt (dry-run still runs first).
  -h, --help        Show this help.

This script always runs \`npm publish --dry-run\` first. It will not call the
real \`npm publish\` without an explicit "yes" (either --yes or an interactive
confirmation).
EOF
}

# ---- parse args -----------------------------------------------------------

VERSION=""
AUTO_YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --yes|-y)  AUTO_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)         die "unknown argument: $1 (try --help)" ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  read -r -p "  ? publish: version to publish (e.g. 0.1.0): " VERSION
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  die "version '$VERSION' doesn't look like semver (X.Y.Z or X.Y.Z-pre.N)."
fi

command -v npm  >/dev/null 2>&1 || die "npm is required (even if you use bun day-to-day)."
command -v node >/dev/null 2>&1 || die "node is required for the JSON rewrites."
command -v git  >/dev/null 2>&1 || die "git is required to tag the release."

# ---- backup + restore -----------------------------------------------------

BACKED_UP=()

restore_all() {
  local pkg
  for pkg in "${BACKED_UP[@]}"; do
    if [[ -f "$pkg/package.json.bak" ]]; then
      mv "$pkg/package.json.bak" "$pkg/package.json"
      say "restored $pkg/package.json"
    fi
  done
}

trap 'rc=$?; restore_all; exit $rc' EXIT INT TERM

# ---- step 1+2: bump versions + rewrite workspace:* -----------------------

say "bumping versions and rewriting workspace:* -> ^$VERSION"

for pkg in "${PKG_ORDER[@]}"; do
  [[ -f "$pkg/package.json" ]] || die "missing $pkg/package.json"
  cp "$pkg/package.json" "$pkg/package.json.bak"
  BACKED_UP+=("$pkg")

  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const path = '$pkg/package.json';
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    pkg.version = '$VERSION';
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (!pkg[field]) continue;
      for (const [name, range] of Object.entries(pkg[field])) {
        if (typeof range === 'string' && range.startsWith('workspace:')) {
          pkg[field][name] = '^$VERSION';
        }
      }
    }
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
  say "  $pkg -> $VERSION"
done

# ---- step 3: dry-run -----------------------------------------------------

say "running npm publish --dry-run for each package..."
for pkg in "${PKG_ORDER[@]}"; do
  ( cd "$pkg" && npm publish --dry-run --access public )
done

# ---- step 4: confirm + real publish --------------------------------------

if [[ "$AUTO_YES" -ne 1 ]]; then
  echo
  read -r -p "  ? publish: really publish v$VERSION to npm? [y/N] " answer
  case "${answer:-}" in
    y|Y|yes|YES) ;;
    *) say "aborted by user. Restoring workspace:* and exiting."; exit 0 ;;
  esac
fi

say "publishing to npm in dep order: core -> mcp -> cli"
for pkg in "${PKG_ORDER[@]}"; do
  ( cd "$pkg" && npm publish --access public )
  say "  published $pkg"
done

# ---- step 5: restore is handled by trap ----------------------------------
# (restore_all runs on EXIT)

# ---- step 6: tag release -------------------------------------------------

TAG="v$VERSION"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  warn "tag $TAG already exists locally -- skipping git tag."
else
  git tag "$TAG"
  say "tagged $TAG"
fi

if git remote get-url origin >/dev/null 2>&1; then
  say "pushing tag $TAG..."
  git push origin "$TAG" || warn "git push failed -- push manually: git push origin $TAG"
else
  warn "no 'origin' remote configured -- skipping tag push."
fi

say "done. v$VERSION is live on npm."
