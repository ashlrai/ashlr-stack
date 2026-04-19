# Stack — Strategy

> Last updated: 2026-04-19. Supersedes scattered notes; authoritative until the next rev lands here.

## What Stack is (in one line)

**The control plane that turns one Claude Code prompt — "stack my backend" — into a running stack with real accounts, vaulted secrets, and MCP wiring.**

## The problem, framed for a term sheet

In a Claude-Code-native world, writing code is no longer the bottleneck. The bottleneck is **account sprawl**: every new project requires 10+ third-party services (database, auth, payments, analytics, errors, deploy, AI), each with its own dashboard, token flow, and `.env` incantation. A senior engineer burns 60–90 minutes per project on account creation, secret copy-paste, and wiring — before writing a single line of product code.

Existing tools solve slices:
- **Vercel v0** — UI code generation only (no services).
- **Railway** — deploy only (no upstream provider accounts).
- **Supabase AI** — Postgres schema only (single-provider lock-in).
- **Pulumi AI** — IaC code generation (doesn't create accounts, doesn't pick providers).
- **Doppler / Phantom** — secrets only (you've already picked your providers).

**Nobody owns "zero to running prod stack with informed provider selection."** That's the wedge.

## Distribution wedge

Three channels, all live on day one:

1. **`npm i -g @ashlr/stack`** — dev-tool default.
2. **`brew install ashlrai/ashlr/stack`** — `homebrew-ashlr` tap, mirrors Phantom's distribution.
3. **Claude Code MCP** — `stack_recommend` + `stack_apply` tools, native in every Claude Code session. One slash-command install via the `ashlr-stack` plugin.

The MCP channel is the asymmetric bet: every Claude Code user who says "build me a SaaS" is a latent Stack customer. The CLI is the surface; MCP is the agentic-workflow conversion.

## Product shape today (v0.1)

- **CLI** (`@ashlr/stack`): 22 commands. `init`, `add`, `recommend`, `apply`, `scan`, `clone`, `status`, `doctor`, `exec`, `sync`, `open`, `info`, `providers`, `templates`, `env`, `deps`, `remove`, `import`, `login`, `projects`, `completion`, `upgrade`, `ci`.
- **MCP server** (`ashlr-stack-mcp`): 19 tools. Same surface, agent-addressable.
- **Claude Code plugin** (`ashlr-stack`): `/stack:recommend`, `/stack:apply`, `/stack:add`, `/stack:doctor`, `/stack:list`, `/stack:status`.
- **Catalog**: 30 working CLI adapters (27 from the AI-layer session + 3 email adapters landed tonight: SendGrid, Mailgun, Postmark). Site currently advertises 39; the remaining 9 phantom entries carry "coming soon" semantics.
- **AI layer**: `stack recommend "<query>"` → BM25+IDF retrieval over the catalog. `--save` freezes a Recipe. `stack apply <id>` replays through `stack add` for every provider + pre-wires Phantom rotation envelopes + drops webhook stubs (Stripe, Clerk, Supabase, GitHub). Claude-MCP-first reasoning; LM Studio/Ollama local SLM fallback for standalone CLI.
- **Phantom integration**: every secret value lives in Phantom. Stack only holds slot names in `.stack.toml`. Zero vault logic in Stack.
- **Thick lifecycle**: `stack add supabase` creates a Supabase project via the Management API. Same pattern for Neon, Vercel, Railway, Sentry, PostHog, GitHub, etc.

## The moat (three layers, ordered by ship-time)

### Moat 1 — Phantom auto-rotation + webhook pre-wiring ✅ shipped

When the AI picks Stripe + Supabase + Clerk for a SaaS, Stack asks Phantom to create **rotating** secret envelopes for every declared key + drops webhook-endpoint stubs. This requires owning a secrets product; Railway/Supabase/Pulumi can't copy it without building Phantom.

### Moat 2 — Live provider MCP queries (next)

`stack recommend` calls Stripe/Supabase/Vercel MCPs at recommend-time to check current pricing, region availability, quotas. Synthesis becomes: "Stripe Billing ($29/mo) + Supabase EU ($10/mo) + Vercel Edge (dynamic) — total ≈ $40/mo for your scale." Competitor copy = maintaining 15+ partner integrations.

### Moat 3 — Cohort telemetry (post-scale)

Anonymized "stacks chosen together" signal feeds the recommender. Requires users first; becomes a network effect ~10k projects in.

## Business model

**Free OSS CLI + paid cloud tier for teams.** Target $20–$200 / mo / team.

### Free (MIT, forever)

- All 22 CLI commands, all MCP tools, all provider adapters.
- Local-first. No account required.
- Phantom-backed secret rotation (uses the user's own Phantom install).
- Claude Code plugin.

### Paid (`stack cloud`) — v0.2+

| Tier | Who | What | Price |
|---|---|---|---|
| **Team** | 2–20 developers | Shared recipe marketplace (org-scoped); team-sync so one `stack cloud sync` provisions everyone's local `.stack.toml` + Phantom envelopes; audit log of who provisioned what; Stack-managed OAuth apps (skips the "register your own Supabase OAuth client" problem); usage analytics per provider. | $29/user/mo |
| **Business** | 20–500 developers | Team + SOC2 audit logs, SSO (via WorkOS), private catalog extensions (BYO provider adapters), priority support, Slack/Discord shared channel. | $99/user/mo |
| **Enterprise** | 500+ developers | Business + on-prem recipe marketplace, dedicated infrastructure, SLAs, security review, custom contracts. | Contact sales |

### Revenue-triggering metrics

- **Time-to-first-deploy** — stack-recommended-then-applied → first service live. Target <10 min.
- **Stacks provisioned/day** — proxy for adoption velocity. Target: 1k stacks/day by M6.
- **Provider partnership depth** — closed OAuth integrations (Supabase, Vercel, Stripe, GitHub). Each = ~5-second account-creation on behalf of the user.
- **Cross-product adoption** — % of Stack users who also install Phantom Cloud, ashlrcode, ashlr-workbench. Measures platform-thinking.

### ARR path

- M1–M3: 500 free users (GitHub stars + HN launch).
- M6: 5k free users, 50 paid teams ($29k MRR, $348k ARR).
- M12: 25k free users, 500 paid teams ($290k MRR, $3.5M ARR).
- M18: 100k free users, 2k paid teams + 5 enterprise ($1.2M MRR, $14M ARR).

These are pre-Series-A targets. A16z / YC infrastructure bar for Series A ≈ $2M ARR with 15%+ MoM growth.

## Roadmap (honest, dated)

### v0.1 (shipped 2026-04-19)

- CLI + MCP + plugin installable via npm / brew / curl.
- 30 CLI adapters + 9 site-advertised "coming soon" entries.
- AI recommendation layer (`stack recommend`) + `stack apply` with Phantom auto-rotation.
- Golden path: auto-init + partial-failure rollback.
- Full AI discoverability (openapi.json, mcp.json, llms.txt, `/docs/recommend`).
- 186 tests, tsc clean, biome clean.

### v0.2 (target 2026-05)

- Ashlr-managed OAuth apps so users don't register their own Supabase / GitHub OAuth clients (kills the biggest first-install friction).
- Headless OAuth fallback (SSH / CI detection → PAT prompt instead of browser timeout).
- `stack cloud login` + basic account plumbing.
- Close the 9 remaining phantom providers to catalog parity (Auth0, WorkOS, Mixpanel, Plausible, Datadog, Grafana, GCP, DigitalOcean, Hetzner, LaunchDarkly).
- Recipe marketplace (read-only, community-curated, pre-vetted).
- 60-second install-to-deploy demo video for the landing page.

### v0.3 (target 2026-06)

- Live provider MCP queries (Moat 2): real-time pricing + region + quota synthesis.
- Paid Team tier goes live.
- Cross-provider secret-rotation orchestration (one command rotates every key in a stack).
- VS Code + JetBrains extensions (wrappers around the CLI + MCP).

### v0.4+ (target 2026-Q3)

- Cohort telemetry (Moat 3).
- Business tier (SOC2, SSO, audit log).
- Stripe Connect OAuth for the marketplace.

## What NOT to do

- **Do not build vault logic in Stack.** Phantom owns secrets; Stack owns slot names. Always compose.
- **Do not add remote-LLM SDKs to the Stack repo.** (`openai`, `@anthropic-ai/sdk`, etc.) The user's Anthropic key belongs to Claude, not to us. OpenAI-compatible local endpoints only.
- **Do not introduce a community recipe DSL in v0.x.** Curated top-30 catalog hand-tuned beats a Flatpak-style marketplace pre-scale.
- **Do not ship provider adapters without a verify() call.** Every adapter either hits a real Management API endpoint on `stack add` or explicitly documents why it's shape-check only (Modal, Convex).
- **Do not ship anything on the site that the CLI can't serve.** The "phantom providers" gap was tolerable for two days; it isn't tolerable for v0.2.

## Open strategic questions

- **Ashlr OAuth app registration.** Currently blocking because `OAUTH_DEFAULTS.supabase = ""`. Unblocks browser-OAuth for Supabase + GitHub and eliminates 90% of first-run friction. Highest-leverage outside-code work.
- **Homebrew tap split vs. unify.** Phantom tap exists (`homebrew-phantom`). Should Stack ship under the same tap (`homebrew-ashlr`) with Phantom re-tapped, or stay separate? Recommend: unify — single `brew tap ashlrai/ashlr` covers the whole suite.
- **Telemetry opt-in defaults.** Cohort-telemetry moat needs data. Default opt-in (sharper moat, weaker trust) vs. default opt-out (lower signal, better launch narrative)? Recommend: opt-out with a compelling "share anonymous provider picks to improve the recommender" in-CLI prompt on first `stack recommend`.
- **VC timing.** Current state (v0.1 launching, MIT, no revenue, sibling products in Ashlr family) is raisable on narrative alone. Delay until v0.3 for real ARR numbers? Recommend: talk to 5 funds at v0.1 for term-sheet optionality; close at v0.2 when the demo video is public and the first 10 paid teams are live.
