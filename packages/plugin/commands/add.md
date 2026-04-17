---
description: Provision a service and wire its secrets + MCP entry. Usage — /stack:add <service>
---

Run `stack_add` via the ashlr-stack MCP server. If the user didn't specify a service, list available providers first with `stack_list` and ask which to add.

Service names are lowercase (supabase, neon, vercel, sentry, posthog, openai, anthropic, xai, deepseek, github, railway, fly, upstash, aws, gcp, google_analytics, stripe, linear, resend, clerk).

If `stack add` fails because Phantom is not installed, surface the install hint: `brew install ashlrai/phantom/phantom`.
