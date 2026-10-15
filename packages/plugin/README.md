# ashlr-stack (Claude Code plugin)

Thin Claude Code plugin with six slash-command files and an MCP entrypoint:

- `/stack:add <service>` — run one provider setup, creating or attaching as its adapter supports
- `/stack:list` — show configured services
- `/stack:status` — inspect local Stack and Phantom metadata
- `/stack:doctor` — report available provider checks and unchecked services
- `/stack:recommend <query>` — retrieve catalog matches and save a reusable recipe
- `/stack:apply <recipe-id>` — replay provider setup and attempt optional wiring; inspect failures

The plugin wraps the `ashlr-stack-mcp` server, which in turn shells out to the `stack` CLI. The CLI is the canonical implementation.

## Install

```bash
# Illustrative public 0.1.1 package setup; requires Bun 1.2+
# Installs the CLI and separate stdio server, not provider accounts
npm i -g @ashlr/stack@0.1.1 ashlr-stack-mcp@0.1.1

# Then inside Claude Code:
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

The server inherits its working directory and forwards CLI output as MCP text. Configure the intended project directory and check the actual client tool list. The recorded public packages are 0.1.1; reviewed source 0.2.1 and historical native release 0.2.0 are separate artifacts. Plugin installation is not provider, credential or installed-runtime acceptance.
