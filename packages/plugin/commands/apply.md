---
description: Apply a saved recipe — provision every provider in it and wire secrets + MCP entries. Usage — /stack:apply <recipe-id>
---

Call `stack_apply` via the ashlr-stack MCP server with the recipe id the user provided.

Invocation:

```
stack_apply { recipe_id: "<user's input>", no_wire: false }
```

What `stack_apply` does:
- Runs `stack init --noInteractive` first if there is no `.stack.toml`.
- Runs `stack add` for each provider in the recipe, one at a time. If some providers fail, the ones that succeeded are rolled back (automatically when, as under MCP, there is no TTY) unless the CLI was given `--noRollback`.
- If at least one provider was added: writes a placeholder Phantom entry for every secret slot the recipe's providers declare (`phantom add <KEY> TODO_STACK_APPLY --rotate`, retried without `--rotate` on Phantom builds that lack the flag), and writes commented-out webhook handler stubs to `.stack/webhooks/<provider>.ts` for Stripe, Clerk, Supabase, and GitHub.
- Runs `stack doctor` at the end (informational; a failing doctor does not fail apply).

If the user appends `--no-wire` (e.g. `/stack:apply rec_xxx --no-wire`), call with `no_wire: true` instead (the CLI flag is `--noWire`). That still provisions every provider through `stack add`; it only skips the placeholder Phantom entries and webhook stubs. It is not a preview: there is no dry-run mode for apply.

After the call succeeds, summarize:
- Which providers were added
- Any providers that were skipped and why (already present, missing API credentials, etc.)
- The envelope and webhook counts apply printed, and any providers phantom-wire skipped

Then suggest the next step verbatim:

> Run `/stack:doctor` to verify every service is reachable and credentials are valid.

If `stack_apply` fails because Phantom is not installed, surface the install hint: `brew install ashlrai/phantom/phantom`. If the recipe id is not found, suggest `/stack:recommend <query>` to create a new one.
