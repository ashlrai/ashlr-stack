# ashlr-stack-mcp

> MCP server for [Ashlr Stack](https://stack.ashlr.ai). Exposes 17 tools and 3 resources so Claude Code / Cursor / Windsurf / Codex can provision every third-party service in a project with one call.

## What it does

`stack` is a CLI. `ashlr-stack-mcp` is the same capabilities as MCP tools so your coding agent can drive Stack directly. Ask Claude "add Supabase to this project" and it calls `stack_add`, which walks OAuth, provisions the project, writes secrets through Phantom, and updates `.mcp.json` — all without leaving the chat.

## Install

One-liner (installs both `stack` and `ashlr-stack-mcp`):

```bash
# macOS / Linux
curl -fsSL stack.ashlr.ai/install.sh | bash

# Windows (PowerShell)
irm https://stack.ashlr.ai/install.ps1 | iex
```

Or manually from the registry:

```bash
bun add -g ashlr-stack-mcp @ashlr/stack
# or
npm i -g ashlr-stack-mcp @ashlr/stack
```

## Wire it into your agent

Drop this into your project's `.mcp.json` (Claude Code, Cursor, Windsurf, Codex — all read the same shape):

```json
{
  "mcpServers": {
    "ashlr-stack": {
      "command": "ashlr-stack-mcp"
    }
  }
}
```

If you installed from source (no global bin), point at the entry directly:

```json
{
  "mcpServers": {
    "ashlr-stack": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/ashlr-stack/packages/mcp/src/server.ts"]
    }
  }
}
```

## Tools (17)

Provisioning: `stack_init`, `stack_add`, `stack_remove`, `stack_import`, `stack_scan`.

Inspection: `stack_list`, `stack_info`, `stack_providers`, `stack_deps`, `stack_doctor`.

Env: `stack_env_show`, `stack_env_diff`, `stack_env_set`, `stack_env_unset`.

Project registry: `stack_projects_list`, `stack_upgrade`.

## Resources (3)

- `stack://current/.stack.toml`
- `stack://current/.stack.local.toml`
- `stack://current/.mcp.json`

The agent can read these directly — no tool call needed — so it always knows the project state before acting.

Full tool + resource reference: **[stack.ashlr.ai/docs/mcp](https://stack.ashlr.ai/docs/mcp)**.

## How secrets are handled

Stack never stores secret values. Every tool call routes through [Phantom Secrets](https://phantom.ashlr.ai) on your machine. The agent only sees slot *names* (like `SUPABASE_URL`, `SUPABASE_ANON_KEY`) — never the values.

## Links

- Docs — [stack.ashlr.ai/docs](https://stack.ashlr.ai/docs)
- MCP reference — [stack.ashlr.ai/docs/mcp](https://stack.ashlr.ai/docs/mcp)
- Repo — [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack)
- Issues — [github.com/ashlrai/ashlr-stack/issues](https://github.com/ashlrai/ashlr-stack/issues)

## License

MIT. See [LICENSE](./LICENSE).
