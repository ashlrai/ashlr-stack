#!/usr/bin/env bash
# Ashlr Stack — one-liner installer.
#
#   curl -fsSL https://stack.ashlr.ai/install.sh | bash
#
# This script installs the `stack` CLI so you can run `stack add supabase`
# immediately after. It tries, in order:
#
#   1. Prebuilt binary from the latest GitHub Release — zero dependencies.
#   2. Published registries (`@ashlr/stack` on npm) — requires bun or node.
#   3. Git clone + symlink — source-install fallback.
#
# It also installs Phantom Secrets (Stack's vault) if it's missing, since every
# `stack add` writes through Phantom.

set -euo pipefail

say()  { printf "  \033[1;35m▲\033[0m stack: %s\n" "$1"; }
warn() { printf "  \033[1;33m!\033[0m stack: %s\n" "$1" >&2; }
die()  { printf "  \033[1;31m✗\033[0m stack: %s\n" "$1" >&2; exit 1; }

# Idempotently add a directory to the user's PATH by appending an export line
# to their shell's rc file. Detects bash/zsh/fish from $SHELL.
add_to_user_path() {
  local bin="$1"
  local marker="# ashlr-stack PATH"
  local shell_name rc
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh)  rc="$HOME/.zshrc" ;;
    fish) rc="$HOME/.config/fish/config.fish" ;;
    *)    rc="$HOME/.bashrc" ;;
  esac
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  if grep -qF "$marker" "$rc" 2>/dev/null; then
    say "$bin already wired into $rc"
    return 0
  fi
  if [ "$shell_name" = "fish" ]; then
    printf '\n%s\nset -gx PATH %s $PATH\n' "$marker" "$bin" >> "$rc"
  else
    printf '\n%s\nexport PATH="%s:$PATH"\n' "$marker" "$bin" >> "$rc"
  fi
  say "added $bin to PATH in $rc (open a new shell or run: source $rc)"
}

REPO="${STACK_REPO:-ashlrai/ashlr-stack}"
REPO_URL="${STACK_REPO_URL:-https://github.com/${REPO}.git}"
INSTALL_DIR="${STACK_INSTALL_DIR:-$HOME/.local/share/ashlr-stack}"

# Where the standalone binary lands on successful prebuilt install.
BIN_DIR_DEFAULT="$HOME/.ashlr/bin"

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
  installed=0
  # Prefer Homebrew on systems that have it (best UX for updates).
  if command -v brew >/dev/null 2>&1; then
    if brew tap ashlrai/phantom >/dev/null 2>&1 && brew install phantom >/dev/null 2>&1; then
      installed=1
    fi
  fi
  # Fall back to phantom's official one-liner. This avoids `bun add -g`
  # /`npm i -g` because the npm package lazy-downloads on first run and
  # bun on Windows doesn't reliably materialize the shim either way.
  if [ "$installed" -ne 1 ]; then
    if curl -fsSL https://phm.dev/install.sh | bash; then
      [ -d "$HOME/.phantom-secrets/bin" ] && export PATH="$HOME/.phantom-secrets/bin:$PATH"
      installed=1
    fi
  fi
  if [ "$installed" -ne 1 ]; then
    warn "phantom-secrets install failed — install manually from https://phm.dev"
  fi
else
  say "phantom already installed — good."
fi

# ---------------------------------------------------------------------------
# 3. Stack CLI — prebuilt binary first, then npm, then git clone.
# ---------------------------------------------------------------------------

detect_target() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) return 1 ;;
  esac
  case "$os" in
    darwin) echo "stack-darwin-${arch}" ;;
    linux)  echo "stack-linux-${arch}"  ;;
    *) return 1 ;;
  esac
}

install_via_binary() {
  local asset url tmp bin_dir sha_url sum actual
  asset=$(detect_target) || { warn "unsupported OS/arch for prebuilt binary — falling back."; return 1; }
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
  sha_url="${url}.sha256"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  say "fetching prebuilt binary: ${asset}"
  if ! curl -fsSL "$url" -o "$tmp/stack"; then
    warn "no prebuilt binary available at $url (release not cut yet?) — falling back."
    return 1
  fi

  # Verify checksum if the server served one.
  if curl -fsSL "$sha_url" -o "$tmp/stack.sha256" 2>/dev/null; then
    sum=$(awk '{print $1}' < "$tmp/stack.sha256")
    if command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$tmp/stack" | awk '{print $1}')
    else
      actual=$(shasum -a 256 "$tmp/stack" | awk '{print $1}')
    fi
    if [ "$sum" != "$actual" ]; then
      die "checksum mismatch on downloaded binary (expected $sum, got $actual)"
    fi
    say "checksum verified"
  else
    warn "no checksum published for this asset — skipping verification."
  fi

  chmod +x "$tmp/stack"
  bin_dir="$BIN_DIR_DEFAULT"
  mkdir -p "$bin_dir"
  mv "$tmp/stack" "$bin_dir/stack"
  say "stack installed to $bin_dir/stack"

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$bin_dir"; then
    add_to_user_path "$bin_dir"
  fi
  return 0
}

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
    add_to_user_path "$BIN_DIR"
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
if install_via_binary; then
  say "installed prebuilt binary from GitHub Releases."
elif install_via_registry; then
  say "installed from npm registry."
else
  say "registry install unavailable — falling back to source."
  install_via_clone
fi

# ---------------------------------------------------------------------------
# 4. Verify.
# ---------------------------------------------------------------------------

if ! command -v stack >/dev/null 2>&1; then
  warn "stack binary installed and PATH updated. Open a new shell (or 'source' your shell rc) and re-run 'stack --help'."
  exit 0
fi

say "done. Version: $(stack --version 2>/dev/null || echo unknown)"
say "try: stack providers    # see the 23 curated providers"
say "     stack init         # scaffold a new project"
