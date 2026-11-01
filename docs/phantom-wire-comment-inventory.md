# Phantom wire comment inventory

This inventory describes the comments in
[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts), particularly the
verification example emitted by `webhookStubFor`. The template is a string in
running TypeScript; its `//` prefixes become comments in the generated file.
The example is illustrative and does not install a handler or verify a request.

## Source comments and their context

| Location | Comment's purpose | Corresponding executable behavior |
| --- | --- | --- |
| [Module header](../packages/core/src/ai/phantom-wire.ts#L1) | Describes the vault-name check, example stubs, opt-out, and unsigned recipes. | Wiring checks names and writes files; it neither stores secret values nor authenticates recipes or webhooks. |
| [`WireResult`](../packages/core/src/ai/phantom-wire.ts#L31) | Documents present and missing secret names, written paths, and skipped providers. | The function fills these arrays; a present name does not validate its value, and skipped means the check was unavailable or the provider unknown. |
| [`WEBHOOK_PROVIDERS`](../packages/core/src/ai/phantom-wire.ts#L42) | Tells maintainers to keep the list and mappings aligned. | The set limits generated stubs to Stripe, Clerk, Supabase, and GitHub. |
| [Missing Phantom branch](../packages/core/src/ai/phantom-wire.ts#L60) | Explains why skipped providers can still have stub files. | A missing installation skips every provider and still writes supported stubs; other installation errors propagate. |
| [`listVaultNames`](../packages/core/src/ai/phantom-wire.ts#L97) | Explains the name-only inventory and unreadable-vault case. | `listSecrets` supplies names; an inventory error returns `undefined`, causing providers to be skipped rather than marked missing. |
| [`verificationHintFor`](../packages/core/src/ai/phantom-wire.ts#L147) | Describes provider-specific guidance and a generic fallback. | The function returns text for the generated TODO; it calls no verification API. |

## Generated example: comments and hypothetical behavior

[`writeWebhookStub`](../packages/core/src/ai/phantom-wire.ts#L110) creates
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
[boundary review](phantom-wire-boundary.md) and
[signature review](phantom-wire-signature-review.md).
