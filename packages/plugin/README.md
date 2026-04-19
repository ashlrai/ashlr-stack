# ashlr-stack (Claude Code plugin)

Thin Claude Code plugin that registers the `ashlr-stack` MCP server and a handful of slash commands:

- `/stack:add <service>` — provision and wire a new service
- `/stack:list` — show configured services
- `/stack:status` — health + Phantom + services at a glance
- `/stack:doctor` — verify every service is reachable
- `/stack:recommend <query>` — AI picks providers for a goal and saves a reusable recipe
- `/stack:apply <recipe-id>` — provision every provider in a recipe and wire secrets

The plugin wraps the `ashlr-stack-mcp` server, which in turn shells out to the `stack` CLI. The CLI is the canonical implementation.

## Install

```bash
# Install the CLI first (provides `stack` on PATH)
npm i -g @ashlr/stack

# Optional global MCP binary (faster than bun-run-from-source)
npm i -g ashlr-stack-mcp

# Then inside Claude Code:
/plugin install ashlr-stack
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
