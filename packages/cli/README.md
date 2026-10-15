# @ashlr/stack

> The `stack` CLI — configure supported services with Phantom-backed credentials and MCP wiring. This source checkout registers 39 providers; use `stack providers` for your installed catalog.

Part of [Ashlr Stack](https://stack.ashlr.ai). See the monorepo at [ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack).

## What it is

`stack` collapses the "spin up ten services" phase of a project into a single command. Instead of tab-hopping between Supabase, Vercel, Sentry, Neon, etc. to create projects and paste secrets into `.env`, you run:

```bash
stack init --template nextjs-supabase-posthog
```

Run from your application's directory. Stack writes configuration, uses provider-specific authentication, provisions where supported, and stores selected credentials through [Phantom Secrets](https://phm.dev/secrets). Vercel prompts for an existing personal access token. Setup does not generate application code or automatically write `.env`; `stack env export --example` separately writes an empty `KEY=` skeleton to `.env.example`.

Stack handles credentials in memory during setup. `.stack.toml` stores the service shape; per-developer IDs belong in the gitignored `.stack.local.toml`. Review project configuration and MCP output before sharing them; the CLI is not a general redaction boundary.

## Install

One-liner (recommended):

```bash
# macOS / Linux
curl -fsSL stack.ashlr.ai/install.sh | bash

# Windows (PowerShell)
irm https://stack.ashlr.ai/install.ps1 | iex
```

Or install manually from the registry:

```bash
bun add -g @ashlr/stack ashlr-stack-mcp    # preferred
# or
npm i -g @ashlr/stack ashlr-stack-mcp
```

Prerequisites:

- [Bun](https://bun.sh) >= 1.2 for the published 0.1.1 CLI/MCP packages, including when launched with `npx`; npm does not supply Bun
- [Phantom Secrets](https://phm.dev/secrets) — installed and initialized for the intended project before writing setup flows

This README describes source version 0.2.1. Registry metadata checked on October 14, 2026 reported CLI/MCP version 0.1.1. Verify your installed `stack --version` and command `--help`; source qualification is separate from publication and provider acceptance.

## Quickstart

```bash
stack init                            # interactive template picker
stack add supabase                    # provider authentication → setup → vault/config/MCP
stack add                             # no arg = interactive provider picker
stack doctor                          # inspect the configured-service health report
stack doctor --all                    # run across every registered project
stack list                            # show this project's stack at a glance
stack providers                       # catalog registered in your installed release
```

Bring Stack to an existing repo:

```bash
stack scan                            # detect providers already in the code
stack scan --auto                     # scans, then runs `stack add` for each
stack import                          # inhale an existing .env into Phantom
stack clone https://github.com/your-org/your-repo       # clone + scan someone else's project
```

Run your app with secrets injected by Phantom:

```bash
stack exec -- bun dev
```

## Commands

A cheat sheet for the current source interface:

| Command | What it does |
| --- | --- |
| `stack init [--template]` | Write Stack configuration in the current directory; optionally provision preset services |
| `stack add [service]` | Add a provider (OAuth + provision + write secrets) |
| `stack remove <service>` | Remove local vault entries, MCP wiring and configuration (or use `--all`); this CLI does not deprovision upstream resources |
| `stack list` | Show services wired into this project |
| `stack info <service>` | Deep-dive on one service (resource, region, docs, MCP name) |
| `stack doctor [--all] [--fix] [--json]` | Inspect health reports; `--fix` attempts supported repair, `--json` formats the report |
| `stack scan [--auto]` | Detect providers from package manifests, configs, `.env.example` |
| `stack import [--from <file>]` | Migrate an existing `.env` into Phantom + `.stack.toml` |
| `stack clone <git-url> [dir]` | git-clone + scan + next-steps |
| `stack providers` | Browse your installed provider catalog |
| `stack templates list` | List starter provider presets |
| `stack deps` | ASCII tree of this stack grouped by category |
| `stack env show` / `stack env diff` | Effective env-var surface vs vault vs config |
| `stack env export --example` | Write a separate `.env.example` with empty values; `--stdout` previews it |
| `stack exec -- <cmd>` | Forward to the installed `phantom exec` runtime |
| `stack projects list|register|remove|where` | Cross-project registry |
| `stack ci init` | Inspect unavailable CI health workflow generation; exits nonzero without writing a workflow |
| `stack completion <bash\|zsh\|fish>` | Emit a shell-completion script |
| `stack upgrade` | Check npm for a newer `@ashlr/stack` release |
| `stack login <provider>` | Refresh credentials for that provider; existing stored credentials are separate from setup staging |
| `stack sync --platform <name>` | Push through Phantom to a configured Vercel, Railway or Fly target |

Full reference with flags, subcommands, and examples: **[stack.ashlr.ai/docs/cli](https://stack.ashlr.ai/docs/cli)**.

## MCP integration

Where supported, `stack add` writes a provider entry to the project's `.mcp.json`; client and provider setup still require verification. See [ashlr-stack-mcp](https://www.npmjs.com/package/ashlr-stack-mcp) for Stack's own server (19 declared tools and up to 3 project resources). Tools are a subset of CLI commands; use the advertised input schemas. Results contain CLI text and `isError`, not a universal structured JSON receipt or sandbox guarantee.

## Configuration

Stack splits config into two files:

- `.stack.toml` — **committed**. Service names, secret slots, MCP wirings.
- `.stack.local.toml` — **gitignored**. `project_id`, `resource_id`, timestamps. Unique per clone.

Teammates can inspect `stack doctor` and use `stack doctor --fix` for supported remediation. Existing vault names can skip repair; name presence is not credential validity or provider acceptance.

Full schema: [stack.ashlr.ai/docs/config](https://stack.ashlr.ai/docs/config).

## Links

- Docs — [stack.ashlr.ai/docs](https://stack.ashlr.ai/docs)
- Quickstart — [stack.ashlr.ai/docs/quickstart](https://stack.ashlr.ai/docs/quickstart)
- Provider catalog — [stack.ashlr.ai/docs/providers](https://stack.ashlr.ai/docs/providers)
- Repo — [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack)
- Issues — [github.com/ashlrai/ashlr-stack/issues](https://github.com/ashlrai/ashlr-stack/issues)

## License

MIT. See the repository [LICENSE](../../LICENSE).
