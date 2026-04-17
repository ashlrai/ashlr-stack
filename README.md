# Ashlr Stack

> The control plane for your entire dev stack. One command to provision, wire, and operate every third‑party service in your project.

**Status:** pre‑alpha, active development.

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

- **Phantom Secrets** — the vault. Real secret values never leave your machine. Stack writes every credential through Phantom.
- **ashlr-plugin** — token-efficiency layer for Claude Code. Orthogonal to Stack.
- **ashlrcode** — multi-provider AI coding CLI. Orthogonal.

Stack is the *control plane*. Phantom is the *vault*. ashlr-plugin is the *context compressor*. They compose.

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

23 providers total. Run `stack providers` to see the live catalog.

## Install

> **Pre-alpha.** The one-liner + brew tap below are placeholders for when v0.1
> ships to registries. For now, use the dev install path.

```bash
# One-liner (installs Phantom Secrets too if missing):
curl -fsSL stack.ashlr.ai/install.sh | bash

# Or, manually:
brew tap ashlrai/phantom && brew install phantom   # prerequisite
bun add -g @ashlr/stack ashlr-stack-mcp            # or: npm i -g
```

**Dev install** (from a local clone of this repo):

```bash
git clone https://github.com/ashlrai/ashlr-stack && cd ashlr-stack
bun install
bun run packages/cli/src/index.ts --help
# Optional: alias stack=`bun run $(pwd)/packages/cli/src/index.ts` so it's on your PATH
```

Then:

```bash
stack init                    # interactive template picker
stack add supabase            # OAuth → new project → secrets → .mcp.json
stack providers               # full catalog (18 services across 7 categories)
stack doctor --fix            # verify every service; re-run setup for anything broken
stack exec -- bun dev         # run with Phantom's secret proxy active
```

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

## Landing page

```bash
cd packages/site
bun install
bun run dev       # http://localhost:4321
bun run build     # static output in dist/
```

Dark-first, magenta accent, Astro + Tailwind v4 + Framer Motion. Three interactive React islands (animated terminal, "with vs without Stack" tab comparison, Claude Code chat mock). `prefers-reduced-motion` honored.

## License

MIT.
