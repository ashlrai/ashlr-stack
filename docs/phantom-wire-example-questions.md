# Phantom wire example and verification questions

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) inventories
declared provider secret **names** and writes webhook examples. Consider a
recipe with `providers: [{ name: "stripe" }]`, wiring enabled, and a readable,
empty Phantom vault. The result has `present: []`,
`missing: ["stripe:STRIPE_SECRET_KEY"]`, `skipped: []`, and one absolute
`webhooks` path ending in `.stack/webhooks/stripe.ts`. It checks the catalog
name; it does not store, reveal, or validate a secret value. In particular,
the webhook secret named in the stub is not the catalog secret in this result.

## What the example shows

The generated Stripe file is entirely commented out. This excerpt is from the
generated example, including the security TODO:

```ts
//   const signature = req.headers.get("stripe-signature");
//   if (!signature) return new Response("Missing signature", { status: 400 });
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything. Until this TODO is done, `body`
//   // is unauthenticated, attacker-controlled input — anyone who can POST
//   // to this endpoint can forge a stripe webhook.
```

If uncommented as written, a missing or empty header gets a 400; any non-empty
header reaches an `ok`/200 response if reading the body succeeds. A body-read
failure rejects the handler. No signature is compared and the body remains
untrusted. Reading text alone does not establish that the exact raw bytes needed
for verification were preserved. The example is not ready to deploy: generating
it neither registers a route nor deploys a handler, and wiring overwrites an
existing file at that path.

The same generator supports Clerk, Supabase, and GitHub, with different header
and secret names; its hints do not establish the verification scheme for a
particular webhook product. Separately, recipe manifests are unsigned, and
catalog name checks do not authenticate their origin or integrity. Use a
trusted recipe source.

## Unanswered verification questions

These questions require answers for the actual integration before the example
can become a trusted handler; the generated comments do not answer them.

- Which current provider and product documentation specifies the signing
  scheme, required headers, exact payload bytes, and endpoint secret?
- How will the handler preserve those bytes and retrieve the correct secret
  securely, and what happens if either is unavailable?
- Which supported verifier, timestamp tolerance, and replay protections apply?
  If comparing a MAC directly, how will the comparison be constant-time?
- Where will invalid or missing signatures be rejected before the body is parsed,
  trusted, or acted on, and how will body-read failures be handled?
- Which tests prove that valid requests succeed and forged signatures, altered
  bodies, missing headers, and applicable stale or replayed requests cause no
  side effects?
- Who owns the resulting route and prevents later wiring from overwriting an
  implemented handler?

For a fuller walkthrough, see the [reading guide](phantom-wire-example-reading-guide.md)
and the [wiring review questions](phantom-wire-review-questions.md).
