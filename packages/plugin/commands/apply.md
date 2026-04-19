---
description: Apply a saved recipe — provision every provider in it and wire secrets + MCP entries. Usage — /stack:apply <recipe-id>
---

Call `stack_apply` via the ashlr-stack MCP server with the recipe id the user provided.

Invocation:

```
stack_apply { recipe_id: "<user's input>", no_wire: false }
```

What `stack_apply` does:
- Runs `stack_add` for each provider in the recipe (creates resources where the provider supports it, otherwise stubs the entry).
- Requests rotating envelopes from Phantom for every secret slot so keys are encrypted at rest and can be rotated without code changes.
- Writes webhook stubs for providers that emit events (Stripe, Clerk, GitHub, Linear, Resend, etc.) so the app can wire them later.
- Updates `.stack.toml` and the MCP entries in one pass.

If the user appends `--no-wire` (e.g. `/stack:apply rec_xxx --no-wire`), call with `no_wire: true` instead. That skips the Phantom envelopes + webhook stubs and only records the providers in `.stack.toml` — useful when the user wants to inspect what would happen before wiring real credentials.

After the call succeeds, summarize:
- Which providers were added
- Any providers that were skipped and why (already present, missing API credentials, etc.)
- The path of the updated `.stack.toml`

Then suggest the next step verbatim:

> Run `/stack:doctor` to verify every service is reachable and credentials are valid.

If `stack_apply` fails because Phantom is not installed, surface the install hint: `brew install ashlrai/phantom/phantom`. If the recipe id is not found, suggest `/stack:recommend <query>` to create a new one.
