#!/usr/bin/env bash
# Lightweight session-start notice: if there's a .stack.toml in the current
# workspace but no matching services in .mcp.json, remind the agent to run
# `stack_doctor` so Claude is aware of the stack state.
set -euo pipefail

if [ -f ".stack.toml" ]; then
  services=$(grep -c '^\[services\.' .stack.toml 2>/dev/null || echo 0)
  echo "[ashlr-stack] .stack.toml detected (${services} services). Run /stack:status for an overview."
fi
exit 0
