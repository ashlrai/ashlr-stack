# Phantom wire assumptions

This describes the current source behavior of
[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts#L48). Wiring
assumes a trusted recipe and a readable Phantom secret-name inventory; neither
assumption establishes authenticity. It does not provision providers or deploy
webhooks.

## Implemented behavior

- The function uses the recipe's provider names and catalog secret names. It
  compares those names with `phantom list --json`; it does not read or write
  secret values. A `present` entry is only evidence that a name appeared in the
  inventory, not that its value is valid or usable. See
  [`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts#L48) and
  [`listSecrets`](../packages/core/src/phantom.ts#L270).
- `present` and `missing` contain `provider:SECRET_NAME` entries when inventory
  is available. `skipped` means the provider was unknown or the inventory
  could not be checked; it does not mean the secret is missing. A missing
  Phantom installation also skips every provider. `noWire` returns empty arrays
  without performing either operation. See
  [`WireResult` and the branching logic](../packages/core/src/ai/phantom-wire.ts#L31).
- Wiring writes fully commented examples to `.stack/webhooks/<provider>.ts` for
  the providers below, even when inventory checks are skipped. It creates the
  directory and **overwrites existing files** at those paths; write failures
  propagate and can leave earlier files in place. The returned paths are
  absolute. See [`writeWebhookStub`](../packages/core/src/ai/phantom-wire.ts#L110).

| Provider | Header in example | Secret named in example |
| --- | --- | --- |
| stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` |
| clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` |
| supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` |
| github | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` |

The named webhook secret is a hint, not necessarily one of the catalog secrets
checked. [`stack apply`](../packages/cli/src/commands/apply.ts#L102) invokes
wiring for the whole recipe after at least one provider succeeds, and reports
wiring errors as warnings. A stub or an apply result does not prove that a
provider was provisioned or an endpoint registered.

## Signature-verification TODO and trust limits

The [`webhookStubFor` TODO](../packages/core/src/ai/phantom-wire.ts#L117) is
commented guidance for a future handler, not implemented verification. The
entire generated handler is commented out. If uncommented as generated, it
rejects an absent or empty header but accepts any non-empty header and returns
200 after reading the body; neither sender nor body is authenticated. The
secret retrieval and provider-specific hints are comments, too.

Before deploying a handler, implement the provider's current documented
verification for its webhook product, including the exact raw body, required
headers, secret and any replay protection; reject invalid requests before
trusting or acting on the body. Prefer the provider's verification library and
use constant-time comparison when implementing a MAC comparison directly.

Recipe manifests are also unsigned, a separate limitation from the webhook
TODO. [`readRecipe`](../packages/core/src/ai/recipe.ts#L105) checks provider
names against the catalog, but that does not authenticate the recipe's origin
or integrity. Review recipes and use a trusted source before applying them.
See the [boundary review](phantom-wire-boundary.md) for error details and the
[signature review](phantom-wire-signature-review.md) for the code map.
