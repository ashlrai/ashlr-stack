# ashlr-stack (Claude Code plugin)

Thin Claude Code plugin (`stack`) with six slash-command files, an MCP
entrypoint, and a SessionStart hook that prints a notice when `.stack.toml`
is present:

- `/stack:add <service>` — run one provider setup, creating or attaching as its adapter supports
- `/stack:list` — show configured services
- `/stack:status` — inspect local Stack and Phantom metadata
- `/stack:doctor` — report available provider checks and unchecked services
- `/stack:recommend <query>` — retrieve catalog matches and save a reusable recipe
- `/stack:apply <recipe-id>` — replay provider setup and attempt optional wiring; inspect failures

The plugin starts the MCP server through `scripts/mcp-entrypoint.sh`. It prefers `ashlr-stack-mcp` on PATH; otherwise it locates the monorepo server source relative to the script and runs it with Bun. The server shells out to the `stack` CLI (override with `STACK_BIN`). The CLI is the canonical implementation. The startup notice does not run a health check or configure a provider.

## Install

```bash
# Install the CLI and MCP packages; check their runtime requirements
# Installs the CLI and separate stdio server, not provider accounts
npm i -g @ashlr/stack ashlr-stack-mcp

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

The server inherits its working directory and forwards CLI output as MCP text. Configure the intended project directory and check the actual client tool list. The CLI and MCP package manifests in this repository declare Node.js >= 20; check the manifests and help for your installed versions. Source checkouts and native releases are separate artifacts. Plugin installation is not provider, credential or installed-runtime acceptance.
