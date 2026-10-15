# Contributing to Ashlr Stack

Thanks for poking around. Stack is early and the surface is intentionally curated — we want depth per provider, not breadth at any cost.

## Dev loop

```bash
bun install
bun test                                    # full suite (bun's test runner)
bunx tsc --noEmit -p tsconfig.json          # typecheck
bun run lint                                # biome check .
bun run packages/cli/src/index.ts providers # smoke CLI
```

No build step for the CLI — Bun runs `.ts` directly.

## Adding a provider

Step-by-step guide with every file to touch: [docs/adding-a-provider.md](./docs/adding-a-provider.md).

Every curated provider implements `Provider` (`packages/core/src/providers/_base.ts`):

- `login(ctx)` — obtain and verify the adapter's auth inputs. Use `_api-key.ts`'s `makeApiKeyProvider` factory for its supported supplied-input flows, or `oauth.ts`'s `runPkceFlow` for an implemented OAuth path. Auth0 currently checks a domain's discovery response rather than authenticating an account.
- `provision(ctx, auth, opts)` — either create a new upstream resource or attach via `opts.existingResourceId`.
- `materialize(ctx, resource, auth)` — return `{ secrets, mcp?, urls? }`. The pipeline handles values in memory and attempts persistence through Phantom; failures can leave partial state.
- `healthcheck?(ctx, entry)` — optional ping; surfaced by `stack doctor`.
- `dashboardUrl?(entry)` — optional; wired into `stack open`.
- `deprovision?(ctx, auth, resourceId)` — optional; lets `stack add` attempt cleanup of a resource it created when a later step fails (implemented for Supabase, Neon, Turso, and Vercel). Attached resources do not acquire deletion authority; failed or unconfirmed cleanup must stay explicit.

Then register in `packages/core/src/providers/index.ts` and add a row to `docs/provider-auth-matrix.md`.

## Coding principles

- **Compose, don't duplicate.** Shell out to Phantom for every secret read/write. Never build a second vault.
- **No hard dependencies on @clack in core.** The CLI is the only package allowed to touch the prompts library.
- **Define meaningful checks.** `healthcheck` is optional; describe what it verifies and what remains unchecked. A passing limited probe is not full account or application acceptance.
- **Use named credential slots.** Canonical service entries reference dedicated secret names. Freeform metadata, overrides and manually edited config are not a general secret-redaction boundary.

## Scope

What Stack v1 is not:

- A secrets manager (that's Phantom).
- A deployment platform (that's Railway/Vercel/Fly).
- A token-efficiency layer (that's ashlr-plugin).

Stack is the orchestration layer that stitches those together for the common "spin up a new project" flow.
