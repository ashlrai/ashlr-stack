---
layout: ~/layouts/LaunchNote.astro
title: "Launch thread — Ashlr Stack v0.2"
description: "The Twitter/X thread for the Ashlr Stack v0.2 launch."
noindex: true
---

# Launch thread (draft)

**Tweet 1 — hook**

you know the hour after `create-next-app`?

tab-hop between Supabase, Vercel, Sentry, PostHog. copy 20 keys into .env.
wire 4 MCP servers by hand.

Stack v0.2 collapses it:

`stack init --template nextjs-supabase-posthog`

one command. everything provisioned. SDKs installed. app boots.

**Tweet 2 — what just happened**

`stack init --template nextjs-supabase-posthog` does:

- opens Supabase OAuth — picks your org, creates the project
- writes URL + anon key + service role key into Phantom (encrypted vault)
- patches .env.local, .mcp.json, .stack.toml
- installs @supabase/supabase-js and posthog-js inline
- no copy-paste, no tab-hopping

**Tweet 3 — swap + rollback (new in v0.2)**

`stack swap supabase --to neon`

migrates your project from one provider to another. secrets in Phantom get
rotated. env references update in place.

`stack rollback supabase` if it goes wrong.

this is the thing v0.1 didn't have.

**Tweet 4 — scope**

39 providers across the full stack:

db · Supabase, Neon, Turso, Convex, Firebase
deploy · Vercel, Railway, Fly, Render, Cloudflare Workers
cloud · AWS
ai · OpenAI, Anthropic, xAI, DeepSeek
obs · Sentry, PostHog
auth · Clerk
payments · Stripe
+ GitHub, Linear, Resend, Upstash, more

**Tweet 5 — secrets story**

Stack refuses to write raw secrets to disk. every value goes into Phantom;
files get a `phm_…` placeholder.

`stack exec -- bun dev` resolves them at spawn time.

if .env.local leaks, the attacker gets meaningless tokens. that's the point.

**Tweet 6 — honest**

pre-alpha. what's NOT working yet:

- npm publish requires 2FA OTP entry — install via brew tap for now
- Supabase OAuth app creation is dashboard-only; can't fully automate new org setup
- 5 of 39 providers are full OAuth; rest use PAT paste while apps register

Phantom is required. free. MIT.

**Tweet 7 — CTA**

`brew install ashlrai/ashlr/stack`

or: `npm i -g @ashlr/stack` (requires 2FA on npm — brew is smoother)

docs: stack.ashlr.ai/docs
repo: github.com/ashlrai/ashlr-stack

reply with the worst tab-hop from your last project. we'll probably add it.

→ stack.ashlr.ai
