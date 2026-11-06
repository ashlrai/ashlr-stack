# Phantom wire example caveats

[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts) generates webhook
examples, not verified production handlers. `wirePhantomForRecipe` writes fully
commented files to `.stack/webhooks/<provider>.ts` for Stripe, Clerk, Supabase,
and GitHub; it does not register or deploy an endpoint. Re-running wiring
**overwrites** an existing stub at that path.

## What the example actually does

The generated handler reads the provider's signature header and returns 400 if
it is absent or empty. It then reads the body and reaches
`TODO(security): signature verification is NOT implemented here.` before
returning 200. The TODO is an instruction, not a verification step. If the
handler is uncommented as generated, any non-empty value for the expected
header reaches the 200 response if the body read succeeds: neither sender nor
payload is authenticated, and the body is attacker-controlled. Do not deploy or act on this example as-is.

| Provider | Header checked by example | Secret named in example |
| --- | --- | --- |
| Stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` |
| Clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` |
| Supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` |
| GitHub | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` |

The secret name and provider-specific hint are comments only. Wiring checks
catalog secret **names** against the Phantom vault; a present name does not
validate its value, retrieve the webhook secret, or authenticate a request.
The example's `req.text()` alone does not establish that the exact raw bytes
needed for verification are preserved.

## Before deploying a handler

Implement the provider's current documented verification scheme for the
particular webhook product, including required headers and timestamp or replay
checks. Preserve the exact body required by that scheme, retrieve the correct
secret securely, and reject missing, malformed, invalid, or stale signatures
before parsing, trusting, or acting on the payload. Use the provider's supported
verification library where available, or a constant-time MAC comparison when
implementing it directly. Test valid and invalid signatures, changed bodies,
missing headers, and applicable timestamp and replay cases. Template hints are
starting points, not proof that a scheme applies to every product.

Recipe manifests have a separate limitation: they are unsigned, and catalog
provider checks do not authenticate their origin or integrity. Use trusted
recipes. See the [verification follow-up](phantom-wire-followup.md) and
[wiring boundary](phantom-wire-boundary.md) for more detail.
