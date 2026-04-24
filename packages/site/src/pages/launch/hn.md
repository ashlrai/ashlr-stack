---
layout: ~/layouts/LaunchNote.astro
title: "Show HN: Ashlr Stack — the control plane for your dev stack"
description: "One command to provision, wire, and operate every third-party service in your project."
noindex: true
---

# Show HN: Stack v0.2 — one command to provision, wire, and boot a full dev stack

Every time I `create-next-app`, I lose the first hour to tab-hopping: Supabase
project, copy URL + anon key + service role, `.env.local`, Vercel project, deploy
hook, Sentry DSN, PostHog key, then manually wire four MCP servers into
`.mcp.json` so Claude can reach into all of it from chat. Same hour, every time,
every project.

v0.2 collapses it:

```bash
brew install ashlrai/ashlr/stack
stack init --template nextjs-supabase-posthog
```

The init command opens the Supabase OAuth dance, provisions the project, writes
three secrets into Phantom (encrypted local vault — raw values never touch
disk), patches `.env.local` + `.mcp.json` + `.stack.toml`, and installs
`@supabase/supabase-js` and `posthog-js` inline. End-to-end in one terminal
session, no browser tab-hopping.

New in v0.2: `stack swap supabase --to neon` migrates a live project to a
different provider — secrets rotated in Phantom, env references updated in
place. `stack rollback` if it goes sideways.

**What's NOT working yet (honest list):**

- **npm 2FA blocker.** Publishing `@ashlr/stack` to npm requires interactive OTP
  entry, which breaks our release automation. Install via `brew install
  ashlrai/ashlr/stack` for now — that path is clean. The npm package exists but
  install-via-npm requires accepting the OTP prompt manually.
- **Supabase OAuth app — dashboard-only limitation.** Supabase's OAuth app
  registration doesn't expose a full org-creation API, so if the OAuth token
  covers an org with no existing projects, we can create a project but can't
  create the org itself. Affects fresh Supabase accounts. Workaround: create
  one project manually in the dashboard once, then Stack can provision freely.
- **5 of 39 providers are full OAuth.** The other 34 use a PAT or API-key paste
  with automated verification. It works; it's just one extra step per provider.
  OAuth app registrations are in progress — takes a week to a month per
  provider depending on their review process.
- **Phantom is required.** Not optional. Stack refuses to write raw secrets to
  disk and shells out to Phantom for every secret operation. One install per
  machine.

**Scope:** 39 providers — Supabase, Neon, Turso, Convex, Firebase, Vercel,
Railway, Fly, Render, Cloudflare Workers, AWS, OpenAI, Anthropic, Sentry,
PostHog, Clerk, Stripe, GitHub, Linear, Resend, Upstash, and more.

**Telemetry:** The CLI itself has none. v0.2 ships a Cloudflare Worker endpoint
for counting install events (just a counter — no project data, no secrets, no
identifiers). You can audit it; it's in the repo.

Free. MIT. Ships as a CLI, an MCP server, and a Claude Code plugin.

- Site: https://stack.ashlr.ai
- Repo: https://github.com/ashlrai/ashlr-stack
- Docs: https://stack.ashlr.ai/docs

---

**First reply (pre-written for founder to post):**

The hardest part to get right was the secret model. Early versions wrote keys
to `.env.local` like everything else, and I kept noticing that the moment a
file touches disk unencrypted, the whole security story is one accidental
commit away from being over.

Phantom's `phm_…` placeholder model is what makes this composable: Stack
writes a meaningless token to the file, `stack exec` resolves it at spawn time,
and `.env.local` is safe to accidentally ship to a screenshot or a gist.

The swap/rollback feature in v0.2 was the other unlock. Being able to say "move
this project from Supabase to Neon" and have the secrets, env references, and
`.stack.toml` all update atomically is the thing that makes Stack feel like a
control plane rather than a one-shot provisioning script.
