#!/usr/bin/env bash
# One-command development setup for a clone of ashlr-stack.
# Idempotent and non-interactive. macOS and Linux only.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

os="$(uname -s)"
case "$os" in
  Darwin|Linux) ;;
  *)
    printf 'setup: this script supports macOS and Linux. This system is %s.\n' "$os" >&2
    exit 1
    ;;
esac

if ! command -v git >/dev/null 2>&1; then
  printf 'setup: git is required.\n' >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'setup: Node.js 20 or newer is required. Install it, then run scripts/setup.sh again.\n' >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 20 ]; then
  printf 'setup: Node.js 20 or newer is required. Found %s.\n' "$(node --version)" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1 && [ -x "${HOME}/.bun/bin/bun" ]; then
  export PATH="${HOME}/.bun/bin:${PATH}"
fi

if ! command -v bun >/dev/null 2>&1; then
  printf 'setup: installing Bun\n'
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
fi

if ! command -v bun >/dev/null 2>&1; then
  printf 'setup: Bun is not on PATH after install.\n' >&2
  exit 1
fi

bun install --frozen-lockfile

smoke_home=""
cleanup() {
  if [ -n "$smoke_home" ]; then
    rm -rf "$smoke_home"
  fi
}
trap cleanup EXIT

smoke_home="$(mktemp -d)"
HOME="$smoke_home" \
  STACK_TELEMETRY=0 \
  STACK_NO_UPDATE_CHECK=1 \
  NO_COLOR=1 \
  bun packages/cli/src/index.ts providers --json >"$smoke_home/providers.json"

bun -e '
const report = JSON.parse(await Bun.file(process.argv[1]).text());
if (report.schema !== "ashlr.stack.providers/v1") process.exit(1);
if (!Array.isArray(report.providers) || report.providers.length === 0) process.exit(1);
if (!Array.isArray(report.unavailable) || report.unavailable.length !== 0) process.exit(1);
' "$smoke_home/providers.json"

printf 'setup: ready (stack providers --json, schema ashlr.stack.providers/v1).\n'
