# @ashlr/stack

> The `stack` CLI — one command to provision, wire, and operate every third-party service in your project. 23 providers, MCP-native, Phantom-backed.

Part of [Ashlr Stack](https://stack.ashlr.ai). See the monorepo at [ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack).

## What it is

`stack` collapses the "spin up ten services" phase of a project into a single command. Instead of tab-hopping between Supabase, Vercel, Sentry, Neon, etc. to create projects and paste secrets into `.env`, you run:

```bash
stack init --template nextjs-supabase-posthog-sentry
```

Stack does the OAuth dance per provider, creates the upstream resource, stores every secret in [Phantom Secrets](https://phantom.ashlr.ai), writes `.env` + `.mcp.json`, and hands you a project ready for `bun dev`.

Secrets never live in Stack — only Phantom. `.stack.toml` is safe to commit; per-developer IDs live in the gitignored `.stack.local.toml`.

## Install

One-liner (recommended):

```bash
# macOS / Linux
curl -fsSL stack.ashlr.ai/install.sh | bash

# Windows (PowerShell)
irm stack.ashlr.ai/install.ps1 | iex
```

Or install manually from the registry:

```bash
bun add -g @ashlr/stack ashlr-stack-mcp    # preferred
# or
npm i -g @ashlr/stack ashlr-stack-mcp
```

Prerequisites:

- [Bun](https://bun.sh) >= 1.2 (or Node.js >= 20)
- [Phantom Secrets](https://phantom.ashlr.ai) — the installer sets this up for you

## Quickstart

```bash
stack init                            # interactive template picker
stack add supabase                    # OAuth → new project → secrets → .mcp.json
stack add                             # no arg = interactive provider picker
stack doctor                          # verify every wired service is healthy
stack doctor --all                    # run across every registered project
stack list                            # show this project's stack at a glance
stack providers                       # full catalog of 23 curated providers
```

Bring Stack to an existing repo:

```bash
stack scan                            # detect providers already in the code
stack scan --auto                     # scans, then runs `stack add` for each
stack import                          # inhale an existing .env into Phantom
stack clone github.com/org/repo       # clone + scan someone else's project
```

Run your app with secrets injected by Phantom:

```bash
stack exec -- bun dev
```

## Commands

22 commands total. A cheat sheet:

| Command | What it does |
| --- | --- |
| `stack init [--template]` | Scaffold a new stack from a template |
| `stack add [service]` | Add a provider (OAuth + provision + write secrets) |
| `stack remove <service>` | Tear down one service (or `--all` for everything) |
| `stack list` | Show services wired into this project |
| `stack info <service>` | Deep-dive on one service (resource, region, docs, MCP name) |
| `stack doctor [--all] [--fix] [--json]` | Healthcheck; `--fix` re-runs setup, `--json` for CI |
| `stack scan [--auto]` | Detect providers from package manifests, configs, `.env.example` |
| `stack import [--from <file>]` | Migrate an existing `.env` into Phantom + `.stack.toml` |
| `stack clone <github-url>` | git-clone + scan + next-steps |
| `stack providers` | Browse the full 23-provider catalog |
| `stack templates` | List starter templates |
| `stack deps` | ASCII tree of this stack grouped by category |
| `stack env show` / `stack env diff` | Effective env-var surface vs vault vs config |
| `stack env set <KEY> <VALUE>` / `stack env unset <KEY>` | Direct secret injection |
| `stack exec -- <cmd>` | Run a command with Phantom secrets in the environment |
| `stack projects list|register|remove|where` | Cross-project registry |
| `stack ci init` | Scaffold a `.github/workflows/stack-ci.yml` |
| `stack completion <bash\|zsh\|fish>` | Emit a shell-completion script |
| `stack upgrade` | Check npm for a newer `@ashlr/stack` release |

Full reference with flags, subcommands, and examples: **[stack.ashlr.ai/docs/cli](https://stack.ashlr.ai/docs/cli)**.

## MCP integration

`stack add` writes to your project's `.mcp.json` so Claude Code / Cursor / Windsurf can use the provider's MCP server immediately. See [ashlr-stack-mcp](https://www.npmjs.com/package/ashlr-stack-mcp) for Stack's own MCP server (17 tools + 3 resources) and [stack.ashlr.ai/docs/mcp](https://stack.ashlr.ai/docs/mcp) for wiring docs.

## Configuration

Stack splits config into two files:

- `.stack.toml` — **committed**. Service names, secret slots, MCP wirings.
- `.stack.local.toml` — **gitignored**. `project_id`, `resource_id`, timestamps. Unique per clone.

Teammates who clone the repo run `stack doctor --fix` and Stack re-authenticates each service for them.

Full schema: [stack.ashlr.ai/docs/config](https://stack.ashlr.ai/docs/config).

## Links

- Docs — [stack.ashlr.ai/docs](https://stack.ashlr.ai/docs)
- Quickstart — [stack.ashlr.ai/docs/quickstart](https://stack.ashlr.ai/docs/quickstart)
- Provider catalog — [stack.ashlr.ai/docs/providers](https://stack.ashlr.ai/docs/providers)
- Repo — [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack)
- Issues — [github.com/ashlrai/ashlr-stack/issues](https://github.com/ashlrai/ashlr-stack/issues)

## License

MIT. See [LICENSE](./LICENSE).
