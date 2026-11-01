# Phantom wire boundary

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) checks the
names of a recipe's catalog secrets against Phantom's project inventory and
writes example webhook files. It returns a `Promise<WireResult>`; it does not
provision providers, initialize a vault, store or reveal secret values, or
install webhook endpoints.

## Inputs

- `recipe: Recipe` is an already constructed object (see the [`Recipe` type](../packages/core/src/ai/recipe.ts)). Only `providers[].name` is used. Names are matched exactly and case-sensitively by [`findProviderRef`](../packages/core/src/catalog.ts); catalog `secrets` supply the names to check. The wire function does not validate the rest of the recipe or authenticate its origin. [`readRecipe`](../packages/core/src/ai/recipe.ts) separately validates provider names, but recipe files are unsigned; use trusted recipes.
- `opts.cwd` selects the project directory for the inventory command and stub files; it defaults to `process.cwd()`. The installation probe itself does not use this directory.
- `opts.noWire` defaults to false. When true, the function immediately returns four empty arrays without probing Phantom, listing secrets, or writing stubs.

## Outputs and side effects

The [`WireResult`](../packages/core/src/ai/phantom-wire.ts) arrays contain:

| Field | Meaning |
| --- | --- |
| `present` | `provider:SECRET_NAME` for each catalog secret found in the inventory. |
| `missing` | `provider:SECRET_NAME` for each catalog secret absent from a successfully read inventory. |
| `webhooks` | Absolute paths written for supported webhook providers. |
| `skipped` | Provider names whose secrets could not be classified because Phantom was unavailable, the inventory could not be read, or the provider was unknown. |

Entries follow recipe order and catalog secret order; they are not deduplicated.
An empty `missing` array does not prove all secrets exist: check `skipped` as
well. A present name is inventory metadata, not proof that a value is readable,
valid, or usable. Even an empty provider list triggers the installation and
inventory checks unless `noWire` is set.

[`listVaultNames`](../packages/core/src/ai/phantom-wire.ts) calls
[`listSecrets`](../packages/core/src/phantom.ts), which runs `phantom list
--json` in `cwd` and accepts a JSON array of objects with nonempty string
`name` fields. The wire function compares names only. It never writes to the
vault. [`writeWebhookStub`](../packages/core/src/ai/phantom-wire.ts) creates
`.stack/webhooks/` as needed and overwrites `<provider>.ts` for `stripe`,
`clerk`, `supabase`, and `github`, including on repeated calls. This happens
even if the provider's vault check was skipped.

[`webhookStubFor`](../packages/core/src/ai/phantom-wire.ts) generates a fully
commented example with a provider-specific header, secret name, and
verification hint. It does **not** verify a signature. If uncommented as-is,
the example rejects a missing or empty signature header with 400, but accepts
any nonempty one and returns 200 after reading the body; a body-read error
rejects the handler. The body remains untrusted until proper provider-specific
signature verification is implemented. Stub secret names are examples and
are not necessarily among the catalog secrets checked by this function.

## Errors and partial effects

- If [`assertPhantomInstalled`](../packages/core/src/phantom.ts) throws `PhantomNotInstalledError`, every recipe provider is added to `skipped` and supported stubs are still written. Other errors from that installation assertion propagate. The underlying probe treats a failed version command or a probe execution error as Phantom unavailable and caches the result.
- Any error from `listSecrets` is caught by `listVaultNames`: for example, a failed command, malformed JSON, or invalid inventory shape makes the entire inventory unknown. All providers are then skipped, rather than classified as missing, and supported stubs are still written. An unknown catalog provider is likewise skipped without preventing other providers from being classified when inventory is available.
- Directory creation or file writing errors propagate as rejections, including in the missing-Phantom path. There is no rollback: stubs written earlier in the loop can remain, and no `WireResult` is returned on rejection.

The CLI's [`apply` command](../packages/cli/src/commands/apply.ts) invokes the
function after at least one provider is provisioned and catches a rejected wire
call to print a warning. Direct callers must handle rejections themselves.
