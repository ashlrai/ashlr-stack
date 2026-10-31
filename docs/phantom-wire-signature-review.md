# Phantom wire signature review

This review locates every signature-related statement in
[`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts)
and classifies it as **active behavior** (code that runs when
`wirePhantomForRecipe` executes) or **commented follow-up** (text emitted for a
human to act on later). For result shapes, skipped cases, and error paths see
the [boundary review](phantom-wire-boundary.md); for the broader trust
limitations see the [verification review](phantom-wire-review.md) and
[wiring status](phantom-wiring-status.md).

## The commented signature-verification follow-up

The module's only signature-verification work item is a comment that
[`webhookStubFor`](../packages/core/src/ai/phantom-wire.ts) embeds inside each
generated webhook example, immediately after the example reads the request body:

```
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything.
```

It is a follow-up in two senses and inert in both:

- It lives inside an example handler that is itself entirely comments — every
  generated line of `.stack/webhooks/<provider>.ts` is `//`-prefixed or blank —
  so it describes work for whoever deploys a handler, not a step in any program
  Stack runs.
- It stays a comment even after the example is activated. Uncommenting the
  handler does not turn the TODO into code; the runnable lines still contain no
  verification call, MAC computation, or comparison.

The rest of the TODO tells the implementer what verification must do before the
body is trusted — verify over the exact raw body bytes with the webhook secret
(`phantom reveal <PROVIDER>_WEBHOOK_SECRET`), compare in constant time, and
reject missing or invalid signatures before parsing — followed by a per-provider
hint naming the documented scheme. All of it is comment text:

| Provider | Header the example reads | Secret the example names | Verification hint (comment text) |
| --- | --- | --- | --- |
| Stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` | `stripe.webhooks.constructEvent` |
| Clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` | `new Webhook(secret).verify(body, headers)` |
| Supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` | `x-supabase-signature` per Supabase's documented scheme |
| GitHub | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` | `sha256=` + HMAC-SHA256 of the raw body |

## Active behavior

No code path in this module computes, compares, or checks a signature or MAC,
and no secret value is ever read. What actually executes during wiring:

- `assertPhantomInstalled()` probes for the Phantom binary.
- `listSecrets` runs `phantom list --json` and reads secret **names** and
  metadata only; values are never requested, revealed, or validated.
- `writeWebhookStub` creates `.stack/webhooks/` and writes the commented example
  files above (overwriting existing files). This is the only signature-adjacent
  output — nothing registers a route, starts a listener, or authenticates a
  request.
- `signatureHeaderFor`, `webhookSecretKeyFor`, and `verificationHintFor` only
  produce strings interpolated into the stub's comment text.
- `noWire` returns early with four empty arrays; `skipped` records providers
  whose inventory could not be classified.

If the generated example is uncommented as-is, its executable lines do exactly
three things: read the named header and return 400 `Missing signature` when it
is absent or empty; `await req.text()`; and return 200 `ok` for any non-empty
header value. The header value is never compared to anything, so the check
authenticates neither sender nor payload — precisely the gap the TODO flags.
Treat the body as untrusted until the provider's documented verification is
implemented; see [phantom-wire-review.md](phantom-wire-review.md) for the
deployment guidance.

## The other unsigned surface: recipe manifests

A second "signature verification is not implemented" statement appears in the
module docstring, about recipe files rather than webhooks: manifests are
unsigned, and checking provider names against the catalog authenticates neither
a recipe's origin nor its integrity. Unlike the webhook follow-up, no `TODO`
marks future work here — it is a stated limitation of the recipe trust model
(`readRecipe` validates structure and provider names only). Use recipes from a
trusted source.
