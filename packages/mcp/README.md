# ashlr-stack-mcp

> MCP server for [Ashlr Stack](https://stack.ashlr.ai). Exposes 19 tools and up to 3 resources so Claude Code / Cursor / Windsurf / Codex can provision every third-party service in a project with one call.

## What it does

`stack` is a CLI. `ashlr-stack-mcp` is the same capabilities as MCP tools so your coding agent can drive Stack directly. Ask Claude "add Supabase to this project" and it calls `stack_add`, which walks OAuth, provisions the project, writes secrets through Phantom, and updates `.mcp.json` — all without leaving the chat.

## Install

One-liner. It installs `stack`, plus `ashlr-stack-mcp` when it installs from npm or from source; when it installs the prebuilt `stack` binary from GitHub Releases, it prints how to add the MCP server (`npm i -g ashlr-stack-mcp`, or `npx -y ashlr-stack-mcp`):

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

Every tool runs the `stack` CLI, so install `@ashlr/stack` alongside this package (or set `STACK_BIN` to the CLI). Without it the server starts and lists its tools, but each call returns "Could not run the 'stack' CLI" with the fix. The npm 0.1.1 release runs on Bun, so Bun must be installed. In source 0.2.1 this package depends on `@ashlr/stack` and runs that dependency's `stack` bin; the order is `STACK_BIN`, then that bin, then `stack` on PATH.

## Wire it into your agent

Drop this into your project's `.mcp.json` (Claude Code, Cursor and Windsurf read this shape; Codex uses `codex mcp add ashlr-stack -- ashlr-stack-mcp`, which writes `~/.codex/config.toml`):

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
      "args": ["run", "/absolute/path/to/ashlr-stack/packages/mcp/src/server.ts"],
      "env": { "STACK_BIN": "/absolute/path/to/ashlr-stack/packages/cli/src/index.ts" }
    }
  }
}
```

## Tools (19)

Provisioning: `stack_init`, `stack_add`, `stack_remove`, `stack_import`, `stack_scan`.

Inspection: `stack_list`, `stack_info`, `stack_status`, `stack_providers`, `stack_templates_list`, `stack_deps`, `stack_doctor`. `stack_list`, `stack_providers`, `stack_deps`, `stack_templates_list` and `stack_projects_list` take `json: true` to return the CLI's `--json` object instead of human text.

Env: `stack_env_show`, `stack_env_diff`, `stack_sync`.

`stack_info` and `stack_env_show` take `json: true` to return `stack info --json` (`ashlr.stack.info/v1`) and `stack env show --json` (`ashlr.stack.env/v1`) instead of human text.

Planning: `stack_recommend`, `stack_apply`.

Project registry: `stack_projects_list`, `stack_upgrade`.

Every tool rejects an argument name its input schema does not declare, and lists the accepted ones, rather than running without it.

## Resources (up to 3)

Each is listed only when the file exists in the server's working directory.

- `stack://current/.stack.toml`
- `stack://current/.stack.local.toml`
- `stack://current/.mcp.json`

The agent can read these directly — no tool call needed — so it always knows the project state before acting.

Full tool + resource reference: **[stack.ashlr.ai/docs/mcp](https://stack.ashlr.ai/docs/mcp)**.

## How secrets are handled

Stack never stores secret values. Every tool call routes through [Phantom Secrets](https://phm.dev/secrets) on your machine. The agent only sees slot *names* (like `SUPABASE_URL`, `SUPABASE_ANON_KEY`) — never the values.

## Links

- Docs — [stack.ashlr.ai/docs](https://stack.ashlr.ai/docs)
- MCP reference — [stack.ashlr.ai/docs/mcp](https://stack.ashlr.ai/docs/mcp)
- Repo — [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack)
- Issues — [github.com/ashlrai/ashlr-stack/issues](https://github.com/ashlrai/ashlr-stack/issues)

## License

MIT. See [LICENSE](./LICENSE).
