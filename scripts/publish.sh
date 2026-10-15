#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/publish.sh — Ashlr Stack npm publish dance.
#
# Run this when Mason is ready to publish v0.1 (or any subsequent version).
#
# What it does, in order:
#
#   1. Validates the reviewed source version (core, mcp, cli and descriptor).
#      Takes `--version X.Y.Z` or prompts; does not change package versions.
#   2. Rewrites `workspace:*` deps to `^X.Y.Z` so they resolve on a plain
#      `npm install` outside the monorepo. Backs up originals to
#      package.json.bak before touching anything.
#   3. Runs `npm publish --dry-run` for each package in dep order so you can
#      eyeball what would ship.
#   4. Prompts for confirmation. Only on explicit "yes" does it run the real
#      `npm publish` (core → cli → mcp).
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

# Order matters: core is a dep of cli, and cli (@ashlr/stack) is a dep of mcp
# (ashlr-stack-mcp spawns its `stack` bin), so each lands before its dependents.
PKG_ORDER=(
  "packages/core"
  "packages/cli"
  "packages/mcp"
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
    --version) [[ $# -ge 2 && -n "$2" ]] || die "version is required"; VERSION="$2"; shift 2 ;;
    --yes|-y)  AUTO_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)         die "unknown argument (try --help)" ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  read -r -p "  ? publish: version to publish (e.g. 0.1.0): " VERSION || die "version is required"
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  die "invalid version (expected X.Y.Z or X.Y.Z-pre.N)"
fi

command -v npm  >/dev/null 2>&1 || die "npm is required (even if you use bun day-to-day)."
command -v node >/dev/null 2>&1 || die "node is required for the JSON rewrites."
command -v git  >/dev/null 2>&1 || die "git is required to tag the release."

# ---- backup + restore -----------------------------------------------------

# Refuse every pre-existing backup before the restore trap can consume one.
for pkg in "${PKG_ORDER[@]}"; do
  if [[ -e "$pkg/package.json.bak" || -L "$pkg/package.json.bak" ]]; then
    die "existing package backup; refusing to overwrite"
  fi
done

# Read source data only; these guards do not establish publisher or archive authority.
if ! node --input-type=module - "$VERSION" <<'STACK_RELEASE_SOURCE'
import { lstatSync, readFileSync } from 'node:fs';
try {
  const version = process.argv[2];
  const read = (path) => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    return readFileSync(path, 'utf8');
  };
  const manifests = ['core', 'mcp', 'cli'].map((name) =>
    JSON.parse(read(`packages/${name}/package.json`)));
  if (manifests.some((pkg) => pkg.version !== version)) throw new Error();
  if (typeof manifests[1].name !== 'string' || !manifests[1].name) throw new Error();
  const descriptor = JSON.parse(read('packages/mcp/server.json'));
  const entries = Array.isArray(descriptor.packages)
    ? descriptor.packages.filter((pkg) => pkg.registryType === 'npm'
      && pkg.identifier === manifests[1].name) : [];
  if (descriptor.version !== version || entries.length !== 1
      || entries[0].version !== version) throw new Error();
  const cli = read('packages/cli/src/index.ts');
  const declarations = [...cli.matchAll(/^const[ \t]+VERSION[ \t]*=[ \t]*([^;\r\n]+);[ \t]*$/gm)];
  if (declarations.length !== 1) throw new Error();
  const literal = declarations[0][1].trim().match(/^(["'])([^"'\r\n]+)\1$/);
  if (!literal || literal[2] !== version) throw new Error();
} catch {
  process.exit(1);
}
STACK_RELEASE_SOURCE
then
  die "source version validation failed"
fi

# Check an actually selected tag without inventing a branch-dispatch tag owner.
if [[ "${GITHUB_REF:-}" == refs/tags/* ]]; then
  [[ "$GITHUB_REF" == "refs/tags/v$VERSION" ]] || die "selected tag validation failed"
  TAG_COMMIT="$(git rev-parse --verify "refs/tags/v$VERSION^{commit}" 2>/dev/null)" || die "selected tag validation failed"
  HEAD_COMMIT="$(git rev-parse --verify HEAD 2>/dev/null)" || die "selected tag validation failed"
  [[ -n "$TAG_COMMIT" && "$TAG_COMMIT" == "$HEAD_COMMIT" ]] || die "selected tag validation failed"
fi

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

# ---- step 1+2: validate source version + rewrite workspace:* -----------------------

say "validated source version; rewriting workspace:* -> ^$VERSION"

for pkg in "${PKG_ORDER[@]}"; do
  [[ -f "$pkg/package.json" ]] || die "missing $pkg/package.json"
  cp "$pkg/package.json" "$pkg/package.json.bak"
  BACKED_UP+=("$pkg")

  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const path = '$pkg/package.json';
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
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

say "publishing to npm in dep order: core -> cli -> mcp"
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
