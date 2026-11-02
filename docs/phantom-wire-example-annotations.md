# Phantom wire example annotations

[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts#L117) generates a
commented webhook example, rather than a working handler. For Stripe, the
writer puts it at `.stack/webhooks/stripe.ts` under the selected working
directory; the [writer](../packages/core/src/ai/phantom-wire.ts#L110) creates
the directory and overwrites an existing file. The same template is used for
Stripe, Clerk, Supabase, and GitHub, with provider-specific names.

The following excerpt is from the generated Stripe example:

```ts
// export async function handleStripeWebhook(req: Request): Promise<Response> {
//   const signature = req.headers.get("stripe-signature");
//   if (!signature) return new Response("Missing signature", { status: 400 });
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything. Until this TODO is done, `body`
//   // is unauthenticated, attacker-controlled input — anyone who can POST
//   // to this endpoint can forge a stripe webhook.
//   // Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance.
//   // Verify over the exact raw body bytes with the webhook secret
//   // (`phantom reveal STRIPE_WEBHOOK_SECRET`) and compare in
//   // constant time; reject missing or invalid signatures, and only then
//   // parse, trust, or act on the body.
//   return new Response("ok", { status: 200 });
// }
```

- **Example:** The [handler template](../packages/core/src/ai/phantom-wire.ts#L127)
  reads a signature header and the body. Every line is commented out; generating
  the file neither registers nor deploys a handler. If uncommented as written,
  any non-empty signature header reaches the 200 response when the body read
  succeeds, without authenticating the request.
- **Verification reminder:** The [TODO template](../packages/core/src/ai/phantom-wire.ts#L131)
  warns that the body is attacker-controlled and signature verification is not
  implemented. The [provider hint](../packages/core/src/ai/phantom-wire.ts#L152)
  is a starting point, not executable verification. Before deployment, implement
  the provider's current scheme, preserve the required raw body, retrieve the
  secret securely, and reject invalid requests before trusting or acting on the
  body. Include required timestamp or replay checks and use the provider's
  verifier or a constant-time MAC comparison as appropriate.

The `phantom reveal` instruction in the generated file is also a comment; stub
creation does not retrieve the secret. See the
[reading guide](phantom-wire-example-reading-guide.md) for provider mappings and
verification test cases.
