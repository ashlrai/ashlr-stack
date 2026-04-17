#!/usr/bin/env bash
# Ashlr Stack — one-liner installer.
#
#   curl -fsSL stack.ashlr.ai/install.sh | bash
#
# Installs the `stack` CLI globally via bun (preferred) or npm (fallback).
# Also installs Phantom Secrets if it's missing, since Stack depends on it for
# every secret read/write.

set -euo pipefail

say() { printf "  \033[1;35m▲\033[0m stack: %s\n" "$1"; }
warn() { printf "  \033[1;33m!\033[0m stack: %s\n" "$1" >&2; }
die() { printf "  \033[1;31m✗\033[0m stack: %s\n" "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Ensure a package manager is present.
# ---------------------------------------------------------------------------
if command -v bun >/dev/null 2>&1; then
  PKG_MGR="bun"
elif command -v npm >/dev/null 2>&1; then
  PKG_MGR="npm"
else
  die "Neither bun nor npm found on PATH. Install one of them first: https://bun.sh"
fi
say "using ${PKG_MGR}"

# ---------------------------------------------------------------------------
# 2. Install Phantom Secrets (required dependency).
# ---------------------------------------------------------------------------
if ! command -v phantom >/dev/null 2>&1; then
  say "Phantom Secrets not found — installing…"
  if command -v brew >/dev/null 2>&1; then
    brew tap ashlrai/phantom 2>/dev/null || true
    brew install phantom
  elif [ "${PKG_MGR}" = "bun" ]; then
    bun add -g phantom-secrets
  else
    npm i -g phantom-secrets
  fi
else
  say "Phantom already installed — good."
fi

# ---------------------------------------------------------------------------
# 3. Install the Stack CLI.
# ---------------------------------------------------------------------------
say "installing @ashlr/stack…"
if [ "${PKG_MGR}" = "bun" ]; then
  bun add -g @ashlr/stack ashlr-stack-mcp
else
  npm i -g @ashlr/stack ashlr-stack-mcp
fi

# ---------------------------------------------------------------------------
# 4. Verify.
# ---------------------------------------------------------------------------
if ! command -v stack >/dev/null 2>&1; then
  warn "stack installed but not yet on PATH. You may need to open a new shell."
else
  say "done. Try: stack providers"
fi
