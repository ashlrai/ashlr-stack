# Annotated Phantom wire webhook example

[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts) writes illustrative,
fully commented webhook stubs for Stripe, Clerk, Supabase, and GitHub under
`.stack/webhooks/<provider>.ts`. It does not register or deploy a handler. The
excerpt below is from the generated Stripe stub; the other providers use their
own header, secret name, and verification hint.

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

## Annotation

- **Comments:** The entire example is commented out. The TODO and the Stripe
  API name are instructions to the handler author, not executable verification.
- **Header check:** If uncommented as written, a missing or empty header returns
  400. Any non-empty header passes this check; its value is never authenticated.
- **Body and response:** The body is read as text, then the example returns 200
  if the read succeeds. The body is still attacker-controlled; `req.text()`
  alone does not establish that the exact raw bytes needed for verification
  were preserved. Do not deploy or act on this example as-is.
- **Verification TODO:** Before deploying, implement the provider's current
  scheme for the specific webhook product. Preserve the required raw body,
  securely retrieve the correct secret, verify all required headers and any
  timestamp or replay requirements, and reject invalid requests before parsing,
  trusting, or acting on the payload. Use the provider's supported verifier
  where available, or a constant-time MAC comparison when implementing it
  directly. Test valid and invalid signatures, changed bodies, missing headers,
  and applicable timestamp and replay cases.

The generated `phantom reveal` line is a comment, not a secret retrieval. The
separate vault check inventories catalog secret names; it does not verify their
values or authenticate requests. Re-running wiring overwrites existing stub
files. Recipe manifests are also unsigned: catalog name checks do not establish
their origin or integrity, so use trusted recipes. See the
[reading guide](phantom-wire-example-reading-guide.md) for all provider mappings
and the [data flow](phantom-wire-data-flow.md) for wiring behavior.
