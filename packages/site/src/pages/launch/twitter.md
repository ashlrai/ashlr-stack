---
layout: ~/layouts/LaunchNote.astro
title: "Launch thread — Ashlr Stack v0.2"
description: "Historical, unposted Twitter/X draft revised against the reviewed source interfaces."
noindex: true
---

# Launch thread (draft)

**Tweet 1 — hook**

Historical, unposted thread draft revised against source 0.2.1. Public npm 0.1.1 and historical native 0.2.0 are separate artifacts.

Provider setup, credential storage and client configuration have distinct prerequisites. A source example does not prove an app boots.

Review the source-defined template setup:

`stack init --template nextjs-supabase-posthog --noProvision`

Writes template configuration without provisioning. Omit --noProvision only when you intend the selected service setup.

**Tweet 2 — what just happened**

`stack init --template nextjs-supabase-posthog --noProvision` writes split configuration only. It skips provider setup, Phantom credential persistence, MCP descriptor writes and SDK installation.

Omitting --noProvision enables the service setup loop:

- attempts adapter-specific login and setup
- uses Phantom for managed credential slots
- writes conditional MCP descriptors
- SDK installation depends on the install mode and terminal
- does not generate a filled .env.local or prove application readiness

**Tweet 3 — inspect a provider switch**

`stack swap supabase neon --dryRun`

Shows the planned switch. Actual swap sets up the target and attempts old-service cleanup; upstream resources remain.

No registered `stack rollback` command. Inspect partial state and use supported recovery steps.

No automatic data migration, complete credential rotation or atomic rollback guarantee.

**Tweet 4 — scope**

39 source catalog entries, with adapter-specific behavior:

db · Supabase, Neon, Turso, Convex, Firebase
deploy · Vercel, Railway, Fly, Render, Cloudflare
cloud · AWS, GCP
ai · OpenAI, Anthropic, xAI, DeepSeek
obs · Sentry, PostHog
auth · Clerk
payments · Stripe
+ GitHub, Linear, Resend, Upstash and others

**Tweet 5 — secrets story**

Managed credential values use Phantom’s create-only stdin interface. Sequential setup and configuration writes can leave partial state.

`stack exec -- bun dev` forwards to the installed Phantom interface; Stack does not itself resolve environment placeholders.

Project files and literal placeholders are not automatically safe to commit or share.

**Tweet 6 — honest**

pre-alpha. what's NOT working yet:

- source 0.2.1 is not proof of a published or installed version
- 31 API-key factory adapters and eight custom adapters; four have create-resource paths
- configured OAuth and credential verification vary by adapter
- telemetry and update-check controls exist; no blanket no-network claim

Managed credentials require a qualified Phantom project. Stack source is MIT; no future pricing guarantee.

**Tweet 7 — CTA**

`npm i -g @ashlr/stack@0.1.1`

Illustrative recorded public package setup requires Bun 1.2+. Check the actual installed help; source candidate features may differ.

docs: stack.ashlr.ai/docs
repo: github.com/ashlrai/ashlr-stack

Inspect supported interfaces and results before adopting a workflow. No provider or customer acceptance is established by this draft.

→ stack.ashlr.ai
