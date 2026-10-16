# Ashlr Stack

[![CI](https://github.com/ashlrai/ashlr-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/ashlrai/ashlr-stack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![npm version](https://img.shields.io/npm/v/@ashlr/stack.svg)](https://www.npmjs.com/package/@ashlr/stack)

**Configure supported services from your terminal or your AI agent.** Stack uses provider-specific OAuth or supplied credentials, provisions where the adapter supports it, and records selected credentials in [Phantom Secrets](https://phm.dev/secrets), Stack configuration and provider MCP entries. Vercel requires an existing personal access token; Stack does not create that token. Export an empty `.env.example` separately with `stack env export --example`.

**Status:** pre-alpha, active development. This checkout describes source version 0.2.1; registry metadata checked on October 14, 2026 reported 0.1.1 for the CLI and MCP packages. That published release starts both with [Bun](https://bun.sh), so install Bun first, even for the `npx` commands below. Check `stack --version`, `stack --help` and `stack providers` for your installed release. Source changes do not establish package publication or provider readiness.

<!-- Demo GIF: record with vhs, see docs/ -->

## Try it in 30 seconds

Read-only, no accounts or API keys needed:

```bash
npx -y -p @ashlr/stack stack providers                                         # the provider catalog
npx -y -p @ashlr/stack stack recommend "B2B SaaS with auth, AI, and payments"  # ranked picks with rationales
npx -y -p @ashlr/stack stack scan                                              # detect services in an existing repo (writes nothing; add --json in agents and CI)
```

To provision a real service, install Stack (below) and run `stack add <provider>`.

## Connect your agent (MCP)

Every MCP tool runs the `stack` CLI, so the server needs `stack` on its PATH (or `STACK_BIN` set to it). These snippets fetch both packages in one `npx`, which puts `stack` on the server's PATH:

```bash
claude mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp   # Claude Code
codex mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp    # Codex
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "ashlr-stack": { "command": "npx", "args": ["-y", "-p", "@ashlr/stack", "-p", "ashlr-stack-mcp", "ashlr-stack-mcp"] } } }
```

With only `ashlr-stack-mcp`, the server starts and lists its tools, but every call returns "Could not run the 'stack' CLI".

## Why Stack

- **One workflow for supported services.** Stack authenticates, provisions where supported, and updates vault entries, Stack configuration and MCP wiring.
- **Phantom-backed credentials.** Stack handles credentials during setup and persists selected entries through Phantom Secrets. Provider requests, project files and CLI output have their own data boundaries.
- **Agent-native.** MCP exposes selected catalog and setup actions for Claude Code, Codex and Cursor.

## Install

Three ways, pick one:

```bash
# One-liner, macOS / Linux (also installs Phantom Secrets if missing)
curl -fsSL stack.ashlr.ai/install.sh | bash
```

```powershell
# One-liner, Windows (PowerShell)
irm https://stack.ashlr.ai/install.ps1 | iex
```

```bash
# npm / bun registry
bun add -g @ashlr/stack ashlr-stack-mcp     # or: npm i -g
```

**Dev install** (from a local clone of this repo):

```bash
git clone https://github.com/ashlrai/ashlr-stack && cd ashlr-stack
bun install
bun run packages/cli/src/index.ts --help
# Optional: alias stack=`bun run $(pwd)/packages/cli/src/index.ts` so it's on your PATH
```

> Using Stack with an AI coding agent? See [STACK.md](./STACK.md) — a self-contained project brief for agents pulling context from the repo.

## What Stack does

In a Claude‑Code‑native world, the friction in starting a project isn't writing code — it's tab‑hopping to create and wire ten services. Every `npx create-next-app` is followed by an hour of:

- creating a Supabase project, copying URL + anon key + service role key into `.env`
- generating a Vercel token
- picking a Neon region and copying the connection string
- setting up a Sentry project and pasting the DSN
- registering an OAuth app, generating a PAT, pasting keys, adding MCP servers to `.mcp.json`…

Stack collapses that hour into one command:

```bash
stack init --template nextjs-supabase-posthog
# Run from your application's directory. Stack writes its configuration,
# then provisions template services with provider-specific authentication.
# It does not generate application code or automatically write .env.
stack env export --example    # separate empty KEY= skeleton in .env.example
```

## How it relates to the rest of Ashlr

- **[Phantom Secrets](https://phm.dev/secrets)** — the vault. Stack uses its CLI for selected credential storage and runtime operations; provider authentication still uses credentials.
- **[Locus](https://github.com/ashlrai/locus)** — the identity plane. Run `locus run -b <binding> -- stack add …` so provider CLIs act only in the pinned personal / company / client account. See [docs/phantom-locus.md](./docs/phantom-locus.md).
- **ashlr-plugin** — token-efficiency layer for Claude Code. Orthogonal to Stack.
- **ashlrcode** — multi-provider AI coding CLI. Orthogonal.

Stack is the *control plane*. [Phantom Secrets](https://phm.dev/secrets) is the *vault*. ashlr-plugin is the *context compressor*. They compose.

## Curated v1 provider catalog

**Database** — Supabase · Neon · Turso · Convex · Upstash · Firebase
**Deploy** — Vercel · Railway · Fly.io · Cloudflare · Render
**Cloud** — AWS
**AI** — OpenAI · Anthropic · xAI · DeepSeek
**Analytics** — PostHog
**Errors** — Sentry
**Payments** — Stripe
**Code** — GitHub
**Tickets** — Linear
**Email** — Resend
**Auth** — Clerk

Run `stack providers` to see your installed catalog. This source checkout registers 39 providers across 13 categories; the examples above are a subset. `stack templates list` shows the starter presets. Registration does not establish account access or provider acceptance.

## Usage

Before `stack add`, `stack apply`, or a writing `stack import`, check
`phantom status --json` from the project directory. Phantom Secrets 0.7.9
reports `initialized: true` when its project configuration is readable and valid; this
is metadata, not vault or provider health. For a new project that is not yet
configured, run `phantom init --empty` in a trusted terminal, then retry.
These write flows stop before provider login or provisioning when initialization
is unknown or missing, and do not initialize Phantom automatically.

```bash
stack init                    # interactive template picker
stack add supabase            # provider authentication → setup → vault/config/MCP
stack providers               # full provider catalog
stack doctor --fix            # inspect the report and attempt supported remediation
stack exec -- bun dev         # run with Phantom's secret proxy active
```

### AI recommendation layer

Describe what you're building — Stack picks the providers.

```bash
stack recommend "B2B SaaS with auth, AI, and payments"
# → ranked list of matching providers with rationales

stack recommend "serverless postgres" --save
# → freezes a Recipe to .stack/recipes/<id>.toml

stack apply <recipe-id>
# → provisions recipe providers, then attempts optional Phantom wiring
#   and writes webhook stub files; successful rotation is not guaranteed
#   (add --noWire to skip the optional wiring layer)
```

Inside Claude Code, the same flow is one tool call:

```
stack_recommend { query: "B2B SaaS with auth + payments", save: true }
stack_apply     { recipe_id: "<id>" }
```

Reasoning happens in Claude — Stack owns the catalog + execution. Outside Claude, `stack recommend --synth` uses a local SLM (LM Studio on `:1234`, Ollama on `:11434`) for rationales. No remote LLM SDKs live in Stack.

## Bring Stack to an existing project

Already have a repo with services wired up? You don't start from scratch.

```bash
# In an existing repo:
stack scan                    # detects Supabase / Sentry / OpenAI / etc. from package.json, config files, .env.example
stack scan --auto             # scans, then interactively runs `stack add` for each detection
stack import                  # or: inhale an existing .env straight into Phantom + .stack.toml

# Clone someone else's project:
stack clone https://github.com/your-org/your-repo
# → git clone + scans the checkout + prints next steps

# Across every project on this machine:
stack projects list           # everywhere you've used Stack
stack doctor --all            # run health check across all registered projects
```

### How git-sharing works

Stack splits its config into two files so you can commit the shape of a stack without leaking per-developer resource IDs:

- `.stack.toml` — committed. Names of services, their secret slots, MCP wirings.
- `.stack.local.toml` — gitignored automatically. `project_id`, `resource_id`, timestamps. Unique to each clone.

Another developer can inspect `stack doctor` and use `stack doctor --fix` for supported remediation. Review its report; existing vault names can cause remediation to be skipped, and metadata presence does not establish valid credentials or a healthy provider.

## Monorepo layout

```
packages/
  core/     — @ashlr/stack-core — shared logic, provider adapters
  cli/      — @ashlr/stack — the `stack` binary
  mcp/      — ashlr-stack-mcp — MCP wrapper
  plugin/   — Claude Code plugin wrapper
  site/     — Astro landing page (deploys to stack.ashlr.ai)
templates/  — starter stacks
docs/       — auth matrix, schema reference
```

### Publishing

Three packages ship to npm: `@ashlr/stack-core`, `ashlr-stack-mcp`, `@ashlr/stack`. For monorepo dev, `@ashlr/stack` depends on `@ashlr/stack-core` via `workspace:*` — that's what lets `bun install` link the local checkout. A plain `npm install @ashlr/stack` from outside the workspace **cannot resolve `workspace:*`**, so the publish flow has to rewrite those ranges to an actual version (e.g. `^0.1.0`) right before `npm publish`.

Don't hand-edit the `workspace:*` entries in `packages/*/package.json` — dev needs them. Release owners should follow [docs/RELEASE.md](./docs/RELEASE.md), which describes the current script, its limitations and separate package, native and website acceptance gates.

## Landing page

```bash
cd packages/site
bun install
bun run dev       # http://localhost:4321
bun run build     # static output in dist/
```

Dark-first, magenta accent, Astro + Tailwind v4 + Framer Motion. Three interactive React islands (animated terminal, "with vs without Stack" tab comparison, Claude Code chat mock). `prefers-reduced-motion` honored.

## Part of the Ashlr ecosystem

Ashlr Stack is one of the open-source tools from [Ashlr](https://ashlr.ai), a forward-deployed engineering company. Its siblings: [Lexicon](https://github.com/ashlrai/lexicon), [Locus](https://github.com/ashlrai/locus), [Phantom Secrets](https://github.com/ashlrai/phantom-secrets), [Ashlr Markdown](https://github.com/ashlrai/ashlr-md), [Ashlr plugin](https://github.com/ashlrai/ashlr-plugin).

## Contributing

Issues and PRs are welcome. Look for [`good first issue`](https://github.com/ashlrai/ashlr-stack/labels/good%20first%20issue) to get started, and read [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately per [SECURITY.md](SECURITY.md).

## License

MIT.
