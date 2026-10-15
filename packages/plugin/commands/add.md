---
description: Provision a service and wire its secrets + MCP entry. Usage — /stack:add <service>
---

Run `stack_add` via the ashlr-stack MCP server. If the user didn't specify a service, list available providers first with `stack_providers` and ask which to add. (`stack_list` shows services already configured in this stack.)

Service names are lowercase provider ids (anthropic, auth0, aws, braintrust, clerk, cloudflare, convex, datadog, deepseek, digitalocean, firebase, fly, gcp, github, grafana, hetzner, launchdarkly, linear, mailgun, mixpanel, modal, neon, openai, plausible, posthog, postmark, railway, render, replicate, resend, sendgrid, sentry, stripe, supabase, turso, upstash, vercel, workos, xai). `stack_providers` is the authoritative list.

If `stack add` fails because Phantom is not installed, surface the install hint: `brew install ashlrai/phantom/phantom`.
