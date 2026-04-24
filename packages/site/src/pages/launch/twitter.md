---
layout: ~/layouts/LaunchNote.astro
title: "Launch thread — Ashlr Stack"
description: "The Twitter/X thread for the Ashlr Stack v0.1 launch."
noindex: true
---

# Launch thread (draft)

**Tweet 1 — hook**

🔺 you know the hour after `create-next-app`?

the one where you tab-hop between Supabase, Vercel, Sentry, PostHog, copy 20
keys into .env, then wire 4 MCP servers by hand?

we collapsed it into one command. introducing Ashlr Stack. (v0.1, today)

**Tweet 2 — the shape**

`stack add supabase`

opens OAuth. provisions the project. writes SUPABASE_URL + ANON_KEY +
SERVICE_ROLE_KEY into Phantom (encrypted local vault). patches .env.local,
.mcp.json, .stack.toml. installs @supabase/supabase-js.

4 seconds. no copy-paste.

**Tweet 3 — scope**

39 providers across the full stack:

db · Supabase, Neon, Turso, Convex, Firebase
deploy · Vercel, Railway, Fly, Render, Cloudflare
cloud · AWS
ai · OpenAI, Anthropic, xAI, DeepSeek
obs · Sentry, PostHog
auth · Clerk
payments · Stripe
+ GitHub, Linear, Resend, Upstash

**Tweet 4 — MCP**

every command is also an MCP tool. Claude Code / Cursor / Windsurf can run
`stack_add`, `stack_doctor`, `stack_deps` directly in chat.

we ship a plugin too — `/stack:add supabase` inside Claude Code provisions +
wires everything without a terminal round-trip.

**Tweet 5 — secrets story**

Stack refuses to write raw secrets to disk. every value goes into Phantom;
files get a `phm_…` placeholder.

`stack exec -- bun dev` resolves them at spawn time.

if .env.local leaks, the attacker gets meaningless tokens. that's the whole
point.

**Tweet 6 — honest**

pre-alpha. 97 tests, not "battle-tested". 5 of 39 providers are full OAuth;
the rest still use PAT paste while the OAuth apps register (weeks per
provider).

Phantom is required — it's the whole security story.

free. MIT. no telemetry.

**Tweet 7 — CTA**

CLI: `curl -fsSL stack.ashlr.ai/install | bash`
Docs: stack.ashlr.ai/docs
Repo: github.com/ashlrai/ashlr-stack

would love to hear which providers to wire next. reply with the worst
tab-hop from your last project and we'll probably add it.

→ stack.ashlr.ai
