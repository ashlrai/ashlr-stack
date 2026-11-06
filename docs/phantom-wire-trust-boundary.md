# Phantom wire trust boundary

[`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts)
draws a trust boundary it does not enforce.
**Signature verification is not implemented** anywhere in the module, for
either of the two things it consumes or produces: recipe manifests and webhook
requests. This page lists what must not be trusted until verification exists. For line-level classification see the
[signature review](phantom-wire-signature-review.md); for result shapes and
error paths see the [boundary review](phantom-wire-boundary.md).

## What is unimplemented

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

## Required order once verification is added

1. Read the exact raw body bytes (`req.text()` or an array buffer), without
   parsing or re-serializing them.
2. Reveal the webhook secret at call time with
   `phantom reveal <PROVIDER>_WEBHOOK_SECRET`.
3. Verify with the provider's documented scheme, using a constant-time
   comparison, and reject missing or invalid signatures.
4. Only then parse the body and act on it.

The per-provider headers, secret names and scheme hints are in the table in the
[signature review](phantom-wire-signature-review.md).

## What the module does enforce

- `--no-wire` returns four empty arrays and touches neither the vault nor disk.
- Vault access is read-only; the module never calls `phantom add`.
- Only the four names in `WEBHOOK_PROVIDERS` reach `writeWebhookStub`, so a
  path-traversal name like `../../evil` never becomes a file path. It lands in
  `skipped`.

These limit the damage a hostile recipe can do. They are not authentication.
Use recipes only from a source you trust, and do not deploy a generated webhook
handler before the verification above is implemented.
