# Adding a provider

A provider is one module plus a few registrations. This walks through an
API-key provider, the most common kind; [DeepSeek](../packages/core/src/providers/deepseek.ts)
is a complete example in 24 lines. `bun test` checks that the registry, the
catalog and the auth matrix agree
([provider-parity.test.ts](../packages/core/src/__tests__/provider-parity.test.ts)).

## 1. Write the module

Create `packages/core/src/providers/<name>.ts` and default-export a `Provider`
([`_base.ts`](../packages/core/src/providers/_base.ts)):

- **API key or token:** use `makeApiKeyProvider` from
  [`_api-key.ts`](../packages/core/src/providers/_api-key.ts). Give it the
  secret name, a `howTo` line, and a `verify(key)` that makes one cheap
  authenticated read through `verifyFetch` and returns `undefined` on failure.
- **OAuth:** use `runPkceFlow` from [`oauth.ts`](../packages/core/src/oauth.ts)
  (see [`supabase.ts`](../packages/core/src/providers/supabase.ts)), and follow
  "To register a new provider" in [provider-auth-matrix.md](./provider-auth-matrix.md)
  for the client ID.
- **Creates real resources:** implement `provision` and `materialize`, and add
  `deprovision` so `stack add` can roll back a resource it created when a later
  step fails (see [`neon.ts`](../packages/core/src/providers/neon.ts)).

Secrets go through Phantom; never write them anywhere else.

## 2. Register it

| File | Add |
|------|-----|
| [`providers/index.ts`](../packages/core/src/providers/index.ts) | a lazy loader: `<name>: async () => (await import("./<name>.ts")).default` |
| [`catalog.ts`](../packages/core/src/catalog.ts) | a `PROVIDERS_REF` entry: category, `authKind`, `secrets`, blurb, `keyOnly` if it only stores a key, `dashboard`, `docs`, `howTo`, `sdkPackages`. Drives `stack providers`, `stack recommend` and `stack open`. |
| [`detect.ts`](../packages/core/src/detect.ts) | an env-var rule (`^NAME_` and the primary key) so `stack import` recognizes an existing `.env` |
| [`detect-source.ts`](../packages/core/src/detect-source.ts) | dependency rules (npm, PyPI, Go, Cargo) so `stack scan` finds projects already using it |
| [`provider-auth-matrix.md`](./provider-auth-matrix.md) | a table row (name, category, `authKind`, deprovision, API docs) and the provider count in the header |

## 3. Test it

- API-key providers: add a spec to `SPECS` in
  [`api-key-providers.test.ts`](../packages/core/src/__tests__/api-key-providers.test.ts)
  (secret name, a fake key, a mocked success body). It checks that a verified
  key comes back from `materialize` and lands in the vault.
- Others: add `packages/core/src/__tests__/<name>-provider.test.ts`, mocking
  `fetch` the way [`neon-provider.test.ts`](../packages/core/src/__tests__/neon-provider.test.ts) does.
- Run [`catalog-index.test.ts`](../packages/core/src/__tests__/catalog-index.test.ts)
  to make sure the new catalog entry doesn't push other providers out of their
  `stack recommend` rankings.

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run lint
```

## 4. Site and counts

- [`packages/site/src/lib/providers.ts`](../packages/site/src/lib/providers.ts):
  the landing-page entry (simple-icons slug, brand color, blurb), and an icon
  in [`icons.ts`](../packages/site/src/lib/icons.ts) if simple-icons has none.
- The provider count appears in `README.md` and `packages/site/public/llms*.txt`;
  update it there too.
- Add a line to `CHANGELOG.md` under Unreleased.
