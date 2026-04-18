---
layout: ~/layouts/LaunchNote.astro
title: "Show HN: Ashlr Stack — the control plane for your dev stack"
description: "One command to provision, wire, and operate every third-party service in your project."
noindex: true
---

# Show HN: Ashlr Stack — one command for the 45-minute service-wiring problem

Every time I `create-next-app`, I spend the next hour tab-hopping: log into
Supabase, create a project, copy URL + anon key + service role key, drop them
into `.env.local`, log into Vercel, create the project, copy the deploy hook,
log into Sentry, create a project, copy the DSN, log into PostHog, then
remember to also wire the MCP servers into `.mcp.json` so Claude can reach
into all of this from chat. An hour, every time.

Ashlr Stack collapses that into one command:

```bash
stack add supabase
```

It opens the OAuth dance (where we have an app registered), provisions the
upstream resource, writes the secrets into Phantom (encrypted local vault),
patches `.env.local` + `.mcp.json` + `.stack.toml`, installs the SDK. 4
seconds end-to-end.

Honest caveats:

- v0.1, pre-alpha. We use it daily; wouldn't bet a team-of-50 on it yet.
- Phantom is required — Stack refuses to write raw secrets to disk.
- 5 of 23 providers are full OAuth; the rest still use PAT paste while we
  get OAuth apps registered (takes a week to a month per provider).
- ~97 tests, not "battle-tested in production" — we're still pairing each
  provider with end-to-end recorded sandbox tests.

Free, MIT. Ships as a CLI, an MCP server, and a Claude Code plugin.

- Site: https://stack.ashlr.ai
- Repo: https://github.com/ashlr-ai/stack
- MCP docs: https://stack.ashlr.ai/docs/mcp

Would love your feedback — especially the providers you'd want wired next.
