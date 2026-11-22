# Phantom wire code map

This map covers [`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts):
its active code, its source comments, and the commented webhook example that
`webhookStubFor` emits. The module checks catalog secret **names** against a
Phantom inventory and writes example webhook files; it neither stores secret
values nor verifies signatures.

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

## Source comments and their context

The example template is a string in running TypeScript; its `//` prefixes
become comments in the generated file. The example is illustrative and does not
install a handler or verify a request.

| Location | Comment's purpose | Corresponding executable behavior |
| --- | --- | --- |
| [Module header](../packages/core/src/ai/phantom-wire.ts#L1) | Describes the vault-name check, example stubs, opt-out, and unsigned recipes. | Wiring checks names and writes files; it neither stores secret values nor authenticates recipes or webhooks. |
| [`WireResult`](../packages/core/src/ai/phantom-wire.ts#L31) | Documents present and missing secret names, written paths, and skipped providers. | The function fills these arrays; a present name does not validate its value, and skipped means the check was unavailable or the provider unknown. |
| [`WEBHOOK_PROVIDERS`](../packages/core/src/ai/phantom-wire.ts#L42) | Tells maintainers to keep the list and mappings aligned. | The set limits generated stubs to Stripe, Clerk, Supabase, and GitHub. |
| [Missing Phantom branch](../packages/core/src/ai/phantom-wire.ts#L61) | Explains why skipped providers can still have stub files. | A missing installation skips every provider and still writes supported stubs; other installation errors propagate. |
| [`listVaultNames`](../packages/core/src/ai/phantom-wire.ts#L98) | Explains the name-only inventory and unreadable-vault case. | `listSecrets` supplies names; an inventory error returns `undefined`, causing providers to be skipped rather than marked missing. |
| [`verificationHintFor`](../packages/core/src/ai/phantom-wire.ts#L148) | Describes provider-specific guidance and a generic fallback. | The function returns text for the generated TODO; it calls no verification API. |

## Generated example: comments and hypothetical behavior

[`writeWebhookStub`](../packages/core/src/ai/phantom-wire.ts#L111) creates
`.stack/webhooks/<provider>.ts`, overwriting an existing file, and returns its
absolute path. It writes the template for supported providers even when the
vault inventory is unavailable; `noWire` returns before either operation. File
errors propagate and earlier writes can remain. No route is registered.

| Location in generated example | Text or role | What actually runs |
| --- | --- | --- |
| Preamble | Warns that verification and secret retrieval must be implemented before deployment. | The warning is emitted text. |
| Secret guidance | Suggests `phantom reveal` and names the webhook secret. | The command is commented out; wiring does not execute it or retrieve a value. The named webhook secret need not be a catalog secret checked by wiring. |
| Handler lines | Read a header, reject a missing or empty header, read the body, and return `ok`. | Every line is commented out in the generated file. If uncommented as-is, a missing or empty header returns 400 before reading the body; any non-empty value reaches `req.text()` and then returns 200 without authentication. A body read error propagates. |
| Verification TODO | `TODO(security): signature verification is NOT implemented here.` | This remains a comment even if the outer handler is uncommented. It follows the body read and precedes the success response; no signature is compared. |
| TODO continuation | Warns that the body is attacker-controlled, gives a provider hint, and asks for raw-body verification, constant-time comparison, and rejection before trusting the body. | These are instructions, not a verifier. Implement the provider's current scheme, required headers and replay protections before deploying. The example's `req.text()` alone does not establish preservation of exact raw bytes. |

## The verification TODO in context

Every line of the generated example is commented out. Inside the example, the
TODO follows `req.text()` and precedes the placeholder 200 response. It tells
the future handler author to implement the provider's signature verification
with the webhook secret and the exact body the provider signs, reject invalid
signatures, and only then trust or act on the payload. Follow the current
documentation for the webhook product, including required headers and any
timestamp or replay checks. Use the provider's supported verifier where one
exists, or a constant-time comparison when implementing a MAC check directly.

Even if the handler lines are uncommented, the TODO remains a comment: a
missing or empty signature header returns 400, while any non-empty header
reaches the 200 response if the body read succeeds. The header's presence
authenticates neither sender nor payload, so the body stays attacker-controlled.
Implement and test verification before deploying a handler or acting on its
contents. The vault check inventories secret names; it does not retrieve a
webhook secret or validate its value.

## Provider names and hints

The template interpolates the following names and hints into comments, not
verification calls. The hints are starting points; consult the provider's
current documentation for the specific webhook product.

| Provider | Header | Secret | Hint |
| --- | --- | --- | --- |
| stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` | `stripe.webhooks.constructEvent` |
| clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` | `new Webhook(secret).verify(body, headers)` |
| supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` | `x-supabase-signature` |
| github | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` | `x-hub-signature-256`, `sha256=` |

The module header's unsigned recipe statement is a separate trust limitation:
catalog name checks do not establish a recipe's origin or integrity. Use trusted
recipes. For error details and related context see the
[boundary review](phantom-wire-boundary.md),
[signature review](phantom-wire-signature-review.md) and
[verification follow-up](phantom-wire-signature-review.md#resolving-the-follow-up).
