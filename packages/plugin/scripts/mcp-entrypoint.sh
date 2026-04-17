#!/usr/bin/env bash
# Boot the ashlr-stack MCP server. Prefers a globally installed binary; falls
# back to running the monorepo source via bun when we're inside a dev checkout.
set -euo pipefail

if command -v ashlr-stack-mcp >/dev/null 2>&1; then
  exec ashlr-stack-mcp
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SRC="${SCRIPT_DIR}/../../mcp/src/server.ts"
if [ -f "${MCP_SRC}" ]; then
  exec bun run "${MCP_SRC}"
fi

echo "ashlr-stack MCP: couldn't find ashlr-stack-mcp on PATH or monorepo source." >&2
echo "Install: npm i -g ashlr-stack-mcp" >&2
exit 127
