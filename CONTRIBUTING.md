# Contributing to Ashlr Stack

Thanks for poking around. Stack is early and the surface is intentionally curated — we want depth per provider, not breadth at any cost.

## Dev loop

```bash
bun install
bun test                                    # 10 tests, all green
bunx tsc --noEmit -p tsconfig.json          # typecheck
bun run packages/cli/src/index.ts providers # smoke CLI
```

No build step for the CLI — Bun runs `.ts` directly.

## Adding a provider

Every curated provider implements `Provider` (`packages/core/src/providers/_base.ts`):

- `login(ctx)` — get a token. Use `_api-key.ts`'s `makeApiKeyProvider` factory for paste-and-verify flows, or `oauth.ts`'s `runPkceFlow` for OAuth providers.
- `provision(ctx, auth, opts)` — either create a new upstream resource or attach via `opts.existingResourceId`.
- `materialize(ctx, resource, auth)` — return `{ secrets, mcp?, urls? }`. Secrets go straight into Phantom.
- `healthcheck?(ctx, entry)` — optional ping; surfaced by `stack doctor`.
- `dashboardUrl?(entry)` — optional; wired into `stack open`.

Then register in `packages/core/src/providers/index.ts` and add a row to `docs/provider-auth-matrix.md`.

## Coding principles

- **Compose, don't duplicate.** Shell out to Phantom for every secret read/write. Never build a second vault.
- **No hard dependencies on @clack in core.** The CLI is the only package allowed to touch the prompts library.
- **Every provider ships with a healthcheck.** Otherwise `stack doctor` can't signal drift.
- **Secrets never live in `.stack.toml`.** Only their *names*.

## Scope

What Stack v1 is not:

- A secrets manager (that's Phantom).
- A deployment platform (that's Railway/Vercel/Fly).
- A token-efficiency layer (that's ashlr-plugin).

Stack is the orchestration layer that stitches those together for the common "spin up a new project" flow.
