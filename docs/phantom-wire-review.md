# Phantom wiring verification review

This review describes the current source behavior of [`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts), not a guarantee that any verification is active.

## Recipe manifests

Recipe signature verification is **not implemented**. Recipe manifests are unsigned, so Stack does not authenticate their origin or detect changes to their contents. Reading a local recipe validates its structure and checks provider names against the catalog; neither check establishes who authored it or whether it has been altered. An altered recipe containing known providers can still be applied and cause those providers to be provisioned. Review the contents and use a trusted source before applying a recipe.

## Webhook examples

Wiring creates fully commented examples in `.stack/webhooks/<provider>.ts` for the following providers:

| Provider | Signature header in example | Webhook secret named in example |
| --- | --- | --- |
| Stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` |
| Clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` |
| Supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` |
| GitHub | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` |

Webhook signature verification is **not implemented** in these examples. They do not retrieve a secret or compare a signature. If uncommented as generated, an example rejects an absent or empty expected header, but accepts any non-empty value and returns 200 after reading the body. The header check does not authenticate the sender or payload; an attacker can forge the request. A generated file does not register or deploy an endpoint.

Before deploying a handler, implement the provider's current documented verification procedure for the relevant webhook product. Use the exact raw body, required headers and secret, apply any required timestamp or replay checks, and reject invalid requests before parsing or acting on the payload. Prefer the provider's supported library; use constant-time comparison for a MAC when implementing it directly. The hints in the stubs are starting points, not working verification.

The Phantom vault check only inventories declared secret names; a reported name does not validate its value or authenticate a request. For the full inventory behavior, skipped cases, `--no-wire`, and the stub overwrite warning, see [Phantom wiring status](phantom-wiring-status.md).
