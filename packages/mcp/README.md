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

Every tool runs the `stack` CLI. The server resolves it in this order: the executable specified by `STACK_BIN`, the installed `@ashlr/stack` dependency's bin, then `stack` on PATH. If none is available, the server can still start and list tools, but calls fail with a CLI error. The npm 0.1.1 release runs on Bun, so Bun must be installed for that release.

## Run from a local clone

Install Bun and Node.js 20 or later, then install the workspace dependencies and build the CLI from the repository root:

```bash
bun install --frozen-lockfile
(cd packages/cli && bun run build)
```

The source server runs with Bun; the CLI build provides the workspace dependency's `dist/index.js`. Start the server from the project you want it to inspect, replacing the paths with absolute paths on your machine:

```bash
cd /absolute/path/to/my-project
bun run /absolute/path/to/ashlr-stack/packages/mcp/src/server.ts
```

The server speaks MCP over stdin and stdout, so connect it to an MCP client rather than expecting an interactive prompt. Keep stdout reserved for the protocol. Provider operations may need Phantom and provider credentials configured separately.

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

For a local clone, after the installation and CLI build above, point the client at the source entry directly (with `bun` available on its PATH):

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

The client chooses the server's working directory; the absolute entry path does not set it. Configure the client to start the server in your project if supported, or pass `cwd` to project-scoped tool calls as described below.

## Targeting a project (`cwd`)

Every tool runs `stack` in the server's working directory by default. When your client starts the server outside the project (Claude Desktop, a global Cursor or Windsurf config), pass the project's absolute path to a project-scoped tool:

```json
{ "name": "stack_list", "arguments": { "json": true, "cwd": "/home/me/code/my-app" } }
```

`cwd` is accepted by the project-scoped tools, the ones that read or write `.stack.toml` or other project files: `stack_init`, `stack_import`, `stack_scan`, `stack_add`, `stack_remove`, `stack_list`, `stack_info`, `stack_status`, `stack_env_show`, `stack_env_diff`, `stack_doctor`, `stack_sync`, `stack_deps`, `stack_recommend` and `stack_apply`. It must be an absolute path to an existing directory; it is resolved with realpath, and a relative path, a missing path or a file returns an `isError` result without running anything. It grants nothing beyond what the server's own working directory already does. The global tools (`stack_providers`, `stack_projects_list`, `stack_templates_list`, `stack_upgrade`) refuse `cwd` instead of ignoring it. There is no environment-variable default; start the server in the project or pass `cwd`.

## Tools (19)

Provisioning: `stack_init`, `stack_add`, `stack_remove`, `stack_import`, `stack_scan`.

Inspection: `stack_list`, `stack_info`, `stack_status`, `stack_providers`, `stack_templates_list`, `stack_deps`, `stack_doctor`. `stack_list`, `stack_providers`, `stack_deps`, `stack_templates_list` and `stack_projects_list` take `json: true` to return the CLI's `--json` object instead of human text.

Env: `stack_env_show`, `stack_env_diff`, `stack_sync`.

`stack_info` and `stack_env_show` take `json: true` to return `stack info --json` (`ashlr.stack.info/v1`) and `stack env show --json` (`ashlr.stack.env/v1`) instead of human text.

Planning: `stack_recommend`, `stack_apply`.

Project registry: `stack_projects_list` (`json: true` returns `stack projects list --json`), `stack_upgrade`.

Every tool rejects an argument name its input schema does not declare, and lists the accepted ones, rather than running without it. A blank string (`"  "`) counts as missing for a required argument and is rejected for an optional one.

## Resources (up to 3)

Each is listed only when the file exists in the server's working directory (resources do not take `cwd`).

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
