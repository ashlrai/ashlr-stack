# Phantom wire verification questions

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) writes a fully
commented webhook example to `.stack/webhooks/<provider>.ts` for `stripe`,
`clerk`, `supabase`, and `github`. The example's only verification work item is
a `TODO(security)` comment that `webhookStubFor` emits inside each generated
file, after the body is read and before the success response:

```ts
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything.
```

Signature verification does not exist in this module. Every generated line is
comment text; no code path computes or compares a signature or MAC; the vault
inventory reads secret **names** and never a value. The header names, secret
names, and per-provider hints the template emits are strings interpolated into
comments — they record what the template says, not what a real webhook product
requires. This file records the integration questions those comments leave
**unanswered**. Nothing here is an answer, and nothing in the generated example
verifies a request.

## Unanswered integration questions

Each group below must be resolved for the actual webhook product being
integrated — the specific provider feature, endpoint, and deployment — before a
handler derived from the example can be trusted. If the example is uncommented
unchanged, a missing or empty signature header returns 400, but any non-empty
header reaches `ok`/200 over an unauthenticated, attacker-controlled body.

### Scheme and headers

- Which current provider documentation, for the specific webhook product rather
  than the provider generally, defines the signing scheme this endpoint must
  implement?
- Does that product actually emit the header the example reads, and is the
  generated hint still accurate for the product's current API version?
- Which additional headers carry signed material or required metadata — for
  example timestamps or delivery and event identifiers — and which are
  mandatory for verification?

### Signed bytes

- What exact byte sequence does the provider sign: the raw body alone, a
  timestamp-prefixed payload, or another documented construction?
- Does the hosting framework hand the handler those bytes unchanged, and does
  `await req.text()` preserve them without encoding or normalization changes
  that would break comparison?
- Where will a request with a missing, malformed, or unverifiable signature be
  rejected before the body is parsed, trusted, or acted on?

### Secret material

- Which Phantom vault name actually holds this endpoint's signing secret, and
  does it match the `<PROVIDER>_WEBHOOK_SECRET` the example names only in a
  comment?
- Can the deployed runtime retrieve the secret the way the comment suggests —
  `phantom reveal` at call time — or must the secret reach the handler by a
  different path?
- How will the handler behave when the name is absent from the vault, the value
  cannot be obtained at request time, or the provider rotates the secret?

### Freshness and comparison

- What timestamp tolerance, replay window, or duplicate-delivery protection does
  this product require, and how is that confirmed from documentation rather than
  inferred from a header name?
- Will a supported provider verification library perform the comparison, and
  where a MAC is compared directly, how is the comparison made constant-time?

### Failure handling and evidence

- Which status and side effects result from missing, malformed, invalid, or
  stale signatures, from a body-read failure, and from an unavailable secret —
  and can any of those paths still produce the example's 200?
- Which tests demonstrate that valid requests succeed while forged signatures,
  altered bodies, missing headers, and applicable stale or replayed requests
  cause no side effects?
- Who owns converting each generated file into a verified handler, and how will
  operators distinguish that endpoint from the commented example — including
  when a later wiring run overwrites `.stack/webhooks/<provider>.ts`?

## What the generator names per provider

The strings below are what the emitted examples name; the open questions are
about each real integration, and the generated text does not answer them.
Confirm every row against the provider's current documentation.

| Provider | Header the example reads | Secret the comment names | Verification hint (comment text) | Open question for the integration |
| --- | --- | --- | --- | --- |
| stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` | `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance | Which endpoint secret, raw payload form, and tolerance does the Stripe webhook product in use require? |
| clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` | `new Webhook(secret).verify(body, headers)` | Which Svix headers and secret form must reach `verify`, and what replay window applies? |
| supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` | `x-supabase-signature` per Supabase's documented webhook scheme | Does the Supabase webhook feature in use emit this header and scheme, and where is its verification documented? |
| github | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` | `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body | Which webhook secret and which raw bytes feed the HMAC, and how is the digest compared safely? |

Recipe manifests are a separate unsigned input: catalog name checks
authenticate neither origin nor integrity, so a recipe — like a webhook body —
must come from a trusted source before it is relied on.

For resolution criteria see the
[verification follow-up](phantom-wire-followup.md); for how this TODO is
classified against active code see the
[signature review](phantom-wire-signature-review.md); for adjacent question
sets see the [example questions](phantom-wire-example-questions.md) and the
[review questions](phantom-wire-review-questions.md).
