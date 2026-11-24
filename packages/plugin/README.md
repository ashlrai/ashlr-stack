# ashlr-stack (Claude Code plugin)

Thin Claude Code plugin (`stack`) with six slash-command files, an MCP
entrypoint, and a SessionStart hook that prints a notice when `.stack.toml`
is present:

- `/stack:add <service>` - run one provider setup, creating or attaching as its adapter supports
- `/stack:list` - show configured services
- `/stack:status` - inspect local Stack and Phantom metadata
- `/stack:doctor` - report available provider checks and unchecked services
- `/stack:recommend <query>` - retrieve catalog matches and save a reusable recipe
- `/stack:apply <recipe-id>` - replay provider setup and attempt optional wiring; inspect failures

The plugin starts the MCP server through `scripts/mcp-entrypoint.mjs` (`node`, so it runs on macOS, Windows, and Linux). It prefers `ashlr-stack-mcp` on PATH; otherwise it locates the monorepo server source relative to the script and runs it with Bun. On Windows a global `ashlr-stack-mcp.cmd` shim is started with a shell so PATHEXT can find it. The server shells out to the `stack` CLI (override with `STACK_BIN`). The CLI is the canonical implementation. The startup notice does not run a health check or configure a provider.

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

## Part of the Ashlr ecosystem

This plugin brings Stack, one tool in the [Ashlr ecosystem](https://github.com/ashlrai/ashlr-stack#part-of-the-ashlr-ecosystem), into Claude Code. Together these tools aim to be an autonomous, code-first, agent-native software factory, chasing open-source RSI (recursive self-improvement). Agents do the work, and the human acts as a passive board member. Stack is the service layer, alongside Phantom (runs the agents), [Phantom Secrets](https://github.com/ashlrai/phantom-secrets) (vault), [Locus](https://github.com/ashlrai/locus) (identity plane), [Lexicon](https://github.com/ashlrai/lexicon) (voice lexicon), [Ashlr Markdown](https://github.com/ashlrai/ashlr-md) and the [Ashlr plugin](https://github.com/ashlrai/ashlr-plugin). This `stack` plugin is not the Ashlr plugin: that one is a separate repo and package (`ashlr-plugin`) for Claude Code and Codex. `stack doctor --ecosystem` shows which of these tools are installed; it is read-only.

## Contributing

Coding agents maintain this plugin through pull requests in [ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack). Humans and agents follow the same [contributor path](https://github.com/ashlrai/ashlr-stack/blob/main/CONTRIBUTING.md#contribute-with-an-agent): fork, install, run the checks, open a PR, and merge through the merge queue once the required CI Gate check passes. `packages/site/tests/doc-facts.test.ts` checks the slash-command list above against `commands/*.md`, so add or remove a command file and its line here in the same PR.
