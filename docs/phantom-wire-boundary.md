# Phantom wire boundary

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) checks the
names of a recipe's catalog secrets against Phantom's project inventory and
writes example webhook files. It returns a `Promise<WireResult>`; it does not
provision providers, initialize a vault, store or reveal secret values, or
install webhook endpoints.

This page covers the function's inputs, outputs and error paths, then the
[trust boundary](#trust-boundary) it draws but does not enforce, and the
[verification placeholder](#the-verification-placeholder) in every generated
webhook example.

## Inputs

- `recipe: Recipe` is an already constructed object (see the [`Recipe` type](../packages/core/src/ai/recipe.ts)). Only `providers[].name` is used. Names are matched exactly and case-sensitively by [`findProviderRef`](../packages/core/src/catalog.ts); catalog `secrets` supply the names to check. The wire function does not validate the rest of the recipe or authenticate its origin. [`readRecipe`](../packages/core/src/ai/recipe.ts) separately validates provider names, but recipe files are unsigned; use trusted recipes.
- `opts.cwd` selects the project directory for the inventory command and stub files; it defaults to `process.cwd()`. The installation probe itself does not use this directory.
- `opts.noWire` defaults to false. When true, or when the recipe has no providers, the function immediately returns four empty arrays without probing Phantom, listing secrets, or writing stubs.

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
valid, or usable.

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

## Trust boundary

[`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts)
draws a trust boundary it does not enforce.
**Signature verification is not implemented** anywhere in the module, for
either of the two things it consumes or produces: recipe manifests and webhook
requests. For line-level classification see the
[signature review](phantom-wire-signature-review.md).

### What is unimplemented

1. **Recipe signature verification.** The module docstring states that recipe
   manifests are unsigned. `readRecipe` validates structure only, and
   `findProviderRef` checks provider names against the catalog. Neither
   authenticates who produced a recipe or whether it was modified.
2. **Webhook signature verification.** `webhookStubFor` emits a fully
   commented-out handler whose `TODO(security)` says verification is NOT
   implemented. If someone uncomments it, any non-empty signature header gets a
   200 response. The header value is never compared to anything.

No code path computes or compares a signature or MAC, and no secret value is
ever read (`listSecrets` returns names only).

## Data that must not be trusted before verification

| Data | Origin | Why it is untrusted | Where it flows |
| --- | --- | --- | --- |
| Recipe manifest (`id`, `query`, `createdAt`, `providers`) | A file in `.stack/recipes/` or a remote recipe | Unsigned; origin and integrity are unproven | `wirePhantomForRecipe(recipe)` |
| `providers[].name` | Recipe manifest | Attacker-chosen string; only catalog lookup and the `WEBHOOK_PROVIDERS` set gate it | Vault check, and the stub path `.stack/webhooks/<name>.ts` for the four webhook providers |
| Webhook request body | Anyone who can POST to a deployed handler | The header check proves only that a header arrived | `await req.text()` in the example handler |
| Signature header (`stripe-signature`, `svix-signature`, `x-supabase-signature`, `x-hub-signature-256`) | The same request | Present is not valid; its value is never compared | The 400 `Missing signature` check only |
| Parsed fields of the body (event type, IDs, amounts, user data) | Derived from the body | Forgeable until the raw bytes are verified | Whatever code the implementer adds after the TODO |

Secret names and vault state (`present`, `missing`) come from the local
`phantom list --json` and are local-trust data. They still describe only what
the untrusted recipe asked about.

## What the module does enforce

- `--noWire` returns four empty arrays and touches neither the vault nor disk.
- Vault access is read-only; the module never calls `phantom add`.
- Only the four names in `WEBHOOK_PROVIDERS` reach `writeWebhookStub`, so a
  path-traversal name like `../../evil` never becomes a file path. It lands in
  `skipped`.

These limit the damage a hostile recipe can do. They are not authentication.
Use recipes only from a source you trust, and do not deploy a generated webhook
handler before the verification below is implemented.

## The verification placeholder

Each generated example lives at `.stack/webhooks/<provider>.ts` for Stripe,
Clerk, Supabase, and GitHub. It is a file, not a registered or deployed
endpoint; a later wiring run overwrites the file at that path.

The verification placeholder in `webhookStubFor` appears after the body read
and before the success response in every generated example:

```ts
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything. Until this TODO is done, `body`
```

**The example itself does not implement signature verification.** All of its
lines are comments, including the provider-specific verification hint and the
suggestion to retrieve a secret from Phantom. Generating the file does not
retrieve a secret or authenticate a request. Checking that a vault secret name
is present is only an inventory check, not proof that its value is correct or
that the webhook uses it.

If the handler is uncommented unchanged, an absent or empty signature header
returns 400. Any non-empty value reaches `ok`/200 if the body read succeeds:
the signature is never compared, and the body remains unauthenticated,
attacker-controlled input. A body-read failure rejects the handler. Do not
deploy the example as-is or act on its body.

### Required order once verification is added

1. Read the exact raw body bytes (`req.text()` or an array buffer), without
   parsing or re-serializing them.
2. Reveal the webhook secret at call time with
   `phantom reveal <PROVIDER>_WEBHOOK_SECRET`.
3. Verify with the provider's documented scheme, using a constant-time
   comparison, and reject missing, invalid, and applicable stale or replayed
   requests.
4. Only then parse the body and act on it.

Before using a derived handler, confirm the current signing scheme and required
headers for the specific provider product. The per-provider headers, secret
names and scheme hints are in the table in the
[signature review](phantom-wire-signature-review.md); they are starting points,
not evidence that a scheme applies to a particular product. Test valid
signatures, forged signatures, changed bodies, missing headers, and applicable
freshness and replay cases. See the
[verification questions](phantom-wire-verification-questions.md) for the
review checklist.
