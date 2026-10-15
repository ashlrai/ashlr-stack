# ashlr-stack (Claude Code plugin)

Thin Claude Code plugin (`stack`) that registers the `ashlr-stack` MCP server, a SessionStart hook that notes when a `.stack.toml` is present, and a handful of slash commands:

- `/stack:add <service>` — provision and wire a new service
- `/stack:list` — show configured services
- `/stack:status` — health + Phantom + services at a glance
- `/stack:doctor` — verify every service is reachable
- `/stack:recommend <query>` — AI picks providers for a goal and saves a reusable recipe
- `/stack:apply <recipe-id>` — provision every provider in a recipe and wire secrets

The plugin starts the MCP server through `scripts/mcp-entrypoint.sh`, which runs `ashlr-stack-mcp` from PATH or, in a monorepo checkout, `bun run ../mcp/src/server.ts`. The server shells out to the `stack` CLI (override with `STACK_BIN`). The CLI is the canonical implementation.

## Install

```bash
# Install the CLI first (provides `stack` on PATH)
npm i -g @ashlr/stack

# Optional global MCP binary (faster than bun-run-from-source)
npm i -g ashlr-stack-mcp

# Then inside Claude Code (the plugin is named `stack` in the `ashlr`
# marketplace defined at the repo root, .claude-plugin/marketplace.json):
/plugin marketplace add ashlrai/ashlr-stack
/plugin install stack@ashlr
```

## Architecture

```
Claude Code /stack:* slash commands
         │
         ▼
ashlr-stack MCP server  ──spawn──►  stack CLI  ──spawn──►  phantom CLI
         (stdio)                   (TypeScript)            (Rust)
```

All three are shipped under the Ashlr brand and compose cleanly.
