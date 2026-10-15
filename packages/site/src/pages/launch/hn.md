---
layout: ~/layouts/LaunchNote.astro
title: "Show HN: Ashlr Stack — the control plane for your dev stack"
description: "Historical, unposted launch draft with illustrative source-defined setup and provider-switch workflows."
noindex: true
---

# Show HN: Stack v0.2 — one command to provision, wire, and boot a full dev stack

Historical, unposted Show HN draft, revised against source 0.2.1. Recorded public npm 0.1.1 and historical native 0.2.0 are separate artifacts. The setup below is illustrative, not a posted release or customer acceptance record.

Source template setup to evaluate with a qualified installed version:

```bash
# Config-only init; provider login and a Phantom project are not required
stack init --template nextjs-supabase-posthog --noProvision
```

This config-only example writes the selected template configuration without provisioning. Omit `--noProvision` only when you intend service setup with a qualified Phantom project and authorized provider access: Supabase can create a project; PostHog accepts credentials. SDK installation and MCP descriptors are conditional, and Stack does not fill `.env.local` or establish that the app boots.

`stack swap supabase neon --dryRun` shows the proposed switch. Actual swap sets up the target, then attempts old-service cleanup; it does not migrate data or atomically rotate credentials. There is no registered `stack rollback` command.

**What's NOT working yet (honest list):**

- **Version layers.** Source 0.2.1 is separate from recorded public npm 0.1.1 and historical native 0.2.0. Consumer npm installation does not inherit a publisher OTP requirement.
- **Provider prerequisites.** OAuth app configuration, account permissions and existing resources vary by adapter.
- **Adapter scope.** Of 39 source entries, 31 use the API-key factory and eight are custom; four have resource-creation paths. Verification strength varies.
- **Phantom is required for managed credentials.** Setup and create-only persistence can fail; inspect partial state and qualify the installed interface.

**Scope:** 39 source catalog entries, including Supabase, Neon, Turso, Convex, Firebase, Vercel, Railway, Fly, Render, Cloudflare, AWS, OpenAI, Anthropic, Sentry, PostHog, Clerk, Stripe, GitHub, Linear, Resend and Upstash. Catalog inclusion does not mean upstream creation or runtime acceptance.

**Telemetry:** Source includes opt-in telemetry and update checks. Inspect the installed controls; no blanket no-network, no-identifiers or customer adoption claim is established here.

MIT source, with CLI, MCP server and Claude Code plugin interfaces. Publication and installed capabilities require separate qualification.

- Site: https://stack.ashlr.ai
- Repo: https://github.com/ashlrai/ashlr-stack
- Docs: https://stack.ashlr.ai/docs

---

**First reply (pre-written for founder to post):**

The credential boundary needs explicit qualification. Stack passes managed values through Phantom’s create-only stdin interface, then performs later configuration writes. Some credentials persist earlier, and failures can leave partial state.

Stack does not generate meaningless tokens in `.env.local` or make that file safe to share. `stack exec` forwards to `phantom exec`; runtime credential delivery depends on the separately qualified installed interface.

Swap is a setup-and-cleanup workflow, not an atomic migration or rollback system. Verify target configuration and application behavior, preserve backups, and inspect old-service cleanup results.