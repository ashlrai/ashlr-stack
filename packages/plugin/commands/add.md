---
description: Provision a service and wire its secrets + MCP entry. Usage — /stack:add <service>
---

Run `stack_add` via the ashlr-stack MCP server. If the user didn't specify a service, list available providers first with `stack_providers` and ask which to add. (`stack_list` shows services already configured in this stack.)

Service names are lowercase provider ids (anthropic, auth0, aws, braintrust, clerk, cloudflare, convex, datadog, deepseek, digitalocean, firebase, fly, gcp, github, grafana, hetzner, launchdarkly, linear, mailgun, mixpanel, modal, neon, openai, plausible, posthog, postmark, railway, render, replicate, resend, sendgrid, sentry, stripe, supabase, turso, upstash, vercel, workos, xai). `stack_providers` is the authoritative list.

If Phantom setup is missing or refused, report that boundary and point to https://phm.dev/secrets for the installed-version setup guidance. Do not initialize a vault or grant permissions automatically. Confirm the selected provider and its create/attach and credential effects before calling. The server needs the intended project cwd, Stack CLI and runtime; tool metadata does not prove an installed client exposes the tool or that provider setup succeeds.
