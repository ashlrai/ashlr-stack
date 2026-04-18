#!/usr/bin/env bash
# Ashlr Stack — one-liner installer.
#
#   curl -fsSL https://stack.ashlr.ai/install.sh | bash
#
# This script installs the `stack` CLI so you can run `stack add supabase`
# immediately after. It tries, in order:
#
#   1. Published registries (`@ashlr/stack` on npm) once we ship v0.1 — fast path.
#   2. Git clone + symlink — works today against the current repo.
#
# It also installs Phantom Secrets (Stack's vault) if it's missing, since every
# `stack add` writes through Phantom.

set -euo pipefail

say()  { printf "  \033[1;35m▲\033[0m stack: %s\n" "$1"; }
warn() { printf "  \033[1;33m!\033[0m stack: %s\n" "$1" >&2; }
die()  { printf "  \033[1;31m✗\033[0m stack: %s\n" "$1" >&2; exit 1; }

REPO_URL="${STACK_REPO_URL:-https://github.com/ashlrai/ashlr-stack.git}"
INSTALL_DIR="${STACK_INSTALL_DIR:-$HOME/.local/share/ashlr-stack}"

# ---------------------------------------------------------------------------
# 1. Prerequisites — Bun (preferred) or Node+npm.
# ---------------------------------------------------------------------------

if command -v bun >/dev/null 2>&1; then
  PKG_MGR="bun"
elif command -v npm >/dev/null 2>&1; then
  PKG_MGR="npm"
else
  say "installing bun (needed to run stack)…"
  curl -fsSL https://bun.sh/install | bash >/dev/null
  # shellcheck disable=SC1091
  [ -f "$HOME/.bun/bin/bun" ] && export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "bun install failed — install manually: https://bun.sh"
  PKG_MGR="bun"
fi
say "using $PKG_MGR"

# ---------------------------------------------------------------------------
# 2. Phantom Secrets — Stack's vault.
# ---------------------------------------------------------------------------

if ! command -v phantom >/dev/null 2>&1; then
  say "Phantom Secrets not found — installing…"
  if command -v brew >/dev/null 2>&1; then
    brew tap ashlrai/phantom 2>/dev/null || true
    brew install phantom || warn "brew install failed — continuing; install manually later."
  elif [ "$PKG_MGR" = "bun" ]; then
    bun add -g phantom-secrets 2>/dev/null || warn "bun add -g phantom-secrets failed — install manually later."
  else
    npm i -g phantom-secrets 2>/dev/null || warn "npm i -g phantom-secrets failed — install manually later."
  fi
else
  say "phantom already installed — good."
fi

# ---------------------------------------------------------------------------
# 3. Stack CLI — try registries first, fall back to git clone + symlink.
# ---------------------------------------------------------------------------

install_via_registry() {
  if [ "$PKG_MGR" = "bun" ]; then
    bun add -g @ashlr/stack ashlr-stack-mcp 2>/dev/null
  else
    npm i -g @ashlr/stack ashlr-stack-mcp 2>/dev/null
  fi
}

install_via_clone() {
  say "installing from source (git clone + symlink)…"
  if ! command -v git >/dev/null 2>&1; then
    die "git is required for the source-install path."
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"

  if [ -d "$INSTALL_DIR/.git" ]; then
    say "updating existing checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull --ff-only --quiet
  else
    say "cloning $REPO_URL → $INSTALL_DIR"
    git clone --depth 1 --quiet "$REPO_URL" "$INSTALL_DIR"
  fi

  ( cd "$INSTALL_DIR" && bun install --silent )

  # Pick a bin directory on PATH. Prefer ~/.local/bin; fall back to /usr/local/bin.
  if [ -d "$HOME/.local/bin" ] && echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin"; then
    BIN_DIR="$HOME/.local/bin"
  elif [ -w "/usr/local/bin" ]; then
    BIN_DIR="/usr/local/bin"
  else
    mkdir -p "$HOME/.local/bin"
    BIN_DIR="$HOME/.local/bin"
    warn "$BIN_DIR isn't on your PATH — add it: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  # Write a thin wrapper script so we don't rely on `bun link`.
  cat > "$BIN_DIR/stack" <<EOF
#!/usr/bin/env bash
exec bun run "$INSTALL_DIR/packages/cli/src/index.ts" "\$@"
EOF
  chmod +x "$BIN_DIR/stack"

  # Optional: MCP server binary
  cat > "$BIN_DIR/ashlr-stack-mcp" <<EOF
#!/usr/bin/env bash
exec bun run "$INSTALL_DIR/packages/mcp/src/server.ts" "\$@"
EOF
  chmod +x "$BIN_DIR/ashlr-stack-mcp"

  say "stack wrapper written to $BIN_DIR/stack"
}

say "installing the stack CLI…"
if install_via_registry; then
  say "installed from npm registry."
else
  say "registry install unavailable (v0.1 not published yet) — falling back to source."
  install_via_clone
fi

# ---------------------------------------------------------------------------
# 4. Verify.
# ---------------------------------------------------------------------------

if ! command -v stack >/dev/null 2>&1; then
  warn "stack binary installed but not yet on PATH. Open a new shell or add the bin dir to your PATH."
  exit 0
fi

say "done. Version: $(stack --version 2>/dev/null || echo unknown)"
say "try: stack providers    # see the 23 curated providers"
say "     stack init         # scaffold a new project"
