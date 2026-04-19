#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/sync-phantom-brand.sh — copy Phantom Secrets' logo + favicon from
# the sister repo into Stack's site public assets.
#
# Run from anywhere (pathing is resolved from the script file). Used by
# `packages/site/package.json`'s sync-phantom-brand script (which runs
# pre-dev and pre-build, same pattern as sync-install).
#
# If the Phantom repo isn't checked out locally, this exits 0 silently —
# the committed copies under packages/site/public/brand/phantom/ stay
# authoritative until the next successful sync.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/packages/site/public/brand/phantom"
SRC="${PHANTOM_REPO:-$HOME/Desktop/secrets project/docs}"

mkdir -p "$DEST"

if [[ ! -d "$SRC" ]]; then
  echo "  sync-phantom-brand: $SRC not found — keeping existing committed copies."
  exit 0
fi

for asset in logo.svg favicon.svg; do
  if [[ -f "$SRC/$asset" ]]; then
    cp -f "$SRC/$asset" "$DEST/$asset"
    echo "  sync-phantom-brand: copied $asset"
  else
    echo "  sync-phantom-brand: $SRC/$asset missing — skipped"
  fi
done
