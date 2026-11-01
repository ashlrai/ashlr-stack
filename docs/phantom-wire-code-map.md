# Phantom wire code map

This map covers [`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts).
The module checks catalog secret **names** against a Phantom inventory and writes
example webhook files; it neither stores secret values nor verifies signatures.

## Active code

| Item | Responsibility |
| --- | --- |
| `WireResult` | Describes the `present`, `missing`, `webhooks`, and `skipped` arrays returned to the caller. |
| `WEBHOOK_PROVIDERS` | Limits stub generation to `stripe`, `clerk`, `supabase`, and `github`. |
| `wirePhantomForRecipe` | Returns empty arrays for `noWire`; otherwise checks Phantom availability, classifies each known provider's catalog secret names against the inventory, records skipped providers, and writes stubs for supported providers. If Phantom is missing, it skips all providers but still writes supported stubs; other installation errors propagate. |
| `listVaultNames` | Converts `listSecrets(cwd)` to a set of names; returns `undefined` on any inventory error, so unknown inventory is not reported as missing secrets. |
| `writeWebhookStub` | Creates `.stack/webhooks/` recursively, writes or overwrites `<provider>.ts` with the generated text, and returns its absolute path. File errors propagate. |
| `webhookStubFor` | Builds the fully commented example text, interpolating the handler name, header, secret name, and verification hint. It does not install a handler or verify requests. |
| `verificationHintFor` | Selects provider-specific verification guidance for the generated comment, with a generic fallback. |
| `webhookSecretKeyFor` | Selects the secret name printed in the example, with an uppercase provider-based fallback; it does not retrieve the secret. |
| `signatureHeaderFor` | Selects the header name printed in the example, with `x-webhook-signature` as fallback. |
| `capitalize` | Uppercases the first character for the generated handler name and leaves the rest unchanged. |

`wirePhantomForRecipe` calls `listVaultNames` after the installation check and
`writeWebhookStub` for each supported provider, including when inventory is
unavailable. `writeWebhookStub` calls `webhookStubFor`, which calls the four
formatting and mapping helpers. Writes can leave earlier stubs in place if a
later write fails. For the complete result and error contract, see the
[boundary review](phantom-wire-boundary.md).

## Commented follow-up and limitations

- `webhookStubFor` emits `TODO(security): signature verification is NOT implemented here.` inside the commented example. It asks the eventual handler author to verify the exact raw body with the webhook secret, compare in constant time, and reject missing or invalid signatures before trusting the body. The provider-specific hints are also comments; no verification runs during wiring.
- The example handler itself is commented out. If uncommented as generated, it rejects an absent or empty signature header, reads the body, and returns 200 for any nonempty header without authenticating it. The TODO remains a comment and must be implemented before deploying the handler.
- The module header separately states that recipe manifests are unsigned and catalog name checks do not authenticate their origin or integrity. This is a documented limitation, not the webhook TODO; use trusted recipes.

See the [signature review](phantom-wire-signature-review.md) for the provider
hints and a closer account of the verification boundary.
