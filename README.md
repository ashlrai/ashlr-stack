# Ashlr Stack

[![CI](https://github.com/ashlrai/ashlr-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/ashlrai/ashlr-stack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![npm version](https://img.shields.io/npm/v/@ashlr/stack.svg)](https://www.npmjs.com/package/@ashlr/stack)

**Provision and wire every service in your project with one command, from your terminal or your AI agent.** Stack creates the Supabase project, the Vercel token, the Sentry DSN, stores every secret in [Phantom](https://phm.dev) and writes `.env` and `.mcp.json` for you.

**Status:** pre-alpha, active development. The CLI runs on [Bun](https://bun.sh).

<!-- Demo GIF: record with vhs, see docs/ -->

## Try it in 30 seconds

Read-only, no accounts or API keys needed:

```bash
npx -y -p @ashlr/stack stack providers                                         # the provider catalog
npx -y -p @ashlr/stack stack recommend "B2B SaaS with auth, AI, and payments"  # ranked picks with rationales
npx -y -p @ashlr/stack stack scan                                              # detect services in an existing repo (writes nothing)
```

To provision a real service, install Stack (below) and run `stack add <provider>`.

## Connect your agent (MCP)

```bash
claude mcp add ashlr-stack -- npx -y ashlr-stack-mcp    # Claude Code
codex mcp add ashlr-stack -- npx -y ashlr-stack-mcp     # Codex
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "ashlr-stack": { "command": "npx", "args": ["-y", "ashlr-stack-mcp"] } } }
```

## Why Stack

- **One command instead of ten dashboards.** Stack creates the upstream resource and wires its secrets, `.env` and `.mcp.json`.
- **Secrets stay in a vault.** Every credential goes through Phantom, so real values stay on your machine.
- **Agent-native.** The same catalog and actions are MCP tools for Claude Code, Codex and Cursor.

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
stack init --template nextjs-supabase-posthog-sentry
# Stack does the OAuth dance per provider,
# creates the upstream resource,
# stores every secret in Phantom,
# writes .env + .mcp.json,
# and hands you a project ready for `bun dev`.
```

## How it relates to the rest of Ashlr

- **[Phantom Secrets](https://phm.dev)** — the vault. Real secret values never leave your machine. Stack writes every credential through Phantom.
- **[Locus](https://github.com/ashlrai/locus)** — the identity plane. Run `locus run -b <binding> -- stack add …` so provider CLIs act only in the pinned personal / company / client account. See [docs/phantom-locus.md](./docs/phantom-locus.md).
- **ashlr-plugin** — token-efficiency layer for Claude Code. Orthogonal to Stack.
- **ashlrcode** — multi-provider AI coding CLI. Orthogonal.

Stack is the *control plane*. [Phantom](https://phm.dev) is the *vault*. ashlr-plugin is the *context compressor*. They compose.

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

29 providers total. Run `stack providers` to see the live catalog.

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
stack add supabase            # OAuth → new project → secrets → .mcp.json
stack providers               # full catalog (29 services across 11 categories)
stack doctor --fix            # verify every service; re-run setup for anything broken
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
# → runs `stack add` for each provider + pre-wires Phantom rotating envelopes
#   + drops webhook stubs for Stripe / Clerk / Supabase / GitHub
#   (add --noWire to opt out of the Phantom auto-wiring)
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
stack clone github.com/org/repo
# → git clone + scans the checkout + prints next steps

# Across every project on this machine:
stack projects list           # everywhere you've used Stack
stack doctor --all            # run health check across all registered projects
```

### How git-sharing works

Stack splits its config into two files so you can commit the shape of a stack without leaking per-developer resource IDs:

- `.stack.toml` — committed. Names of services, their secret slots, MCP wirings.
- `.stack.local.toml` — gitignored automatically. `project_id`, `resource_id`, timestamps. Unique to each clone.

Another developer cloning the repo runs `stack doctor --fix` and Stack re-authenticates / re-provisions each service for them, writing a fresh `.stack.local.toml`.

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

Don't hand-edit the `workspace:*` entries in `packages/*/package.json` — dev needs them. Use the publish script instead:

```bash
scripts/publish.sh --version 0.1.0
```

It bumps each package's `version`, swaps `workspace:*` → `^<version>`, runs `npm publish --dry-run` for verification, asks for explicit confirmation, publishes in dep order (`core` → `mcp` → `cli`), restores `workspace:*` so local dev keeps working, and tags the release. See the script header for details.

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
