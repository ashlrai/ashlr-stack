# Phantom wire example annotations

[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts#L118) generates an
illustrative, fully commented webhook example, rather than a working handler. For Stripe, the
writer puts it at `.stack/webhooks/stripe.ts` under the selected working
directory; the [writer](../packages/core/src/ai/phantom-wire.ts#L111) creates
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

- **Example:** The [handler template](../packages/core/src/ai/phantom-wire.ts#L128)
  reads a signature header and the body. Every line is commented out; generating
  the file neither registers nor deploys a handler. If uncommented as written,
  any non-empty signature header reaches the 200 response when the body read
  succeeds, without authenticating the request.
- **Header check:** If uncommented as written, a missing or empty header returns
  400. Any non-empty header passes this check; its value is never authenticated.
- **Body and response:** The body is read as text, then the example returns 200
  if the read succeeds. The body is still attacker-controlled; `req.text()`
  alone does not establish that the exact raw bytes needed for verification
  were preserved. Do not deploy or act on this example as-is.
- **Verification reminder:** The [TODO template](../packages/core/src/ai/phantom-wire.ts#L132)
  warns that the body is attacker-controlled and signature verification is not
  implemented. The [provider hint](../packages/core/src/ai/phantom-wire.ts#L155)
  is a starting point, not executable verification. Before deployment, implement
  the provider's current scheme, preserve the required raw body, retrieve the
  secret securely, and reject invalid requests before trusting or acting on the
  body. Include required timestamp or replay checks and use the provider's
  verifier or a constant-time MAC comparison as appropriate. Test valid and
  invalid signatures, changed bodies, missing headers, and applicable timestamp
  and replay cases. The TODO and the provider hint are instructions to the
  handler author, not executable verification.

The `phantom reveal` instruction in the generated file is also a comment; stub
creation does not retrieve the secret. The separate vault check inventories
catalog secret names; it does not verify their values or authenticate requests.
Recipe manifests are also unsigned: catalog name checks do not establish their
origin or integrity, so use trusted recipes. See the
[reading guide](phantom-wire-example-reading-guide.md) for provider mappings and
the [data flow](phantom-wire-data-flow.md) for wiring behavior.
