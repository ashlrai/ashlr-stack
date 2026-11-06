# Reading a Phantom wire webhook example

[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts) generates a
commented webhook example for each supported provider in a recipe. For a
Stripe entry, the file is `.stack/webhooks/stripe.ts` under the selected working
directory. Wiring creates the directory if needed and **overwrites** an existing
file at that path. It does not register a route or deploy a handler. The whole
generated example is commented out, so none of the handler steps below runs
unless someone first turns it into code.

For example, this excerpt is copied from the **commented-out Stripe stub**:

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

This is a reading example, not an active handler or a verified request. The
TODO describes work still needed; neither generating the stub nor seeing a
signature header performs that work.

Read the generated example from top to bottom:

1. **Preamble.** The file says it is a stub and warns that secret retrieval and
   signature verification must be implemented before deployment. Those warnings
   are comments, not security controls.
2. **Secret guidance.** The `phantom reveal` line names the webhook secret to
   use at request time. It is also a comment: generating the file does not run
   the command or retrieve the secret. The separate vault check compares catalog
   secret names, not values; a webhook secret named in the stub need not be one
   of those catalog entries.
3. **Handler and header.** The example declares a provider-named handler taking
   a `Request`, then reads the provider's signature header with
   `req.headers.get(...)`. If the header is missing or empty, it returns
   `Missing signature` with status 400 before reading the body. A non-empty
   header only shows that a value was supplied; it does not authenticate it.
4. **Body.** `await req.text()` reads the request body. A read failure rejects
   the handler instead of returning the success response. Reading text alone
   does not establish that the exact raw bytes required by a provider's
   verification scheme have been preserved.
5. **Security TODO.** `TODO(security): signature verification is NOT
   implemented here.` marks the missing step, between reading the body and
   returning success. No secret is retrieved and no signature is compared. The
   provider-specific hint and instructions to verify the raw body, compare in
   constant time, and reject invalid signatures are comments, not an
   implementation. Until verification succeeds, the body is unauthenticated,
   attacker-controlled input.
6. **Success response.** The example returns `ok` with status 200. If the
   handler is uncommented as written and the body read succeeds, *any non-empty
   value* in the expected header reaches this response, even a forged signature.
   Do not deploy or act on this example as-is.

The interpolated names differ by provider:

| Provider | Header read | Webhook secret named in comment |
| --- | --- | --- |
| Stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` |
| Clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` |
| Supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` |
| GitHub | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` |

Before deploying, implement the current verification scheme for the provider's
specific webhook product: preserve the required raw body, securely retrieve the
correct secret, include all required headers and timestamp or replay checks,
and reject invalid requests before parsing, trusting, or acting on their bodies.
Use the provider's supported verifier where available, or a constant-time MAC
comparison when implementing it directly. Test valid and invalid signatures,
changed bodies, missing headers, and applicable timestamp and replay cases. The
generated hints are starting points, not verification code.

Recipe manifests have a separate trust boundary: they are unsigned, and checking
provider names against the catalog does not authenticate their origin or
integrity. Use recipes from a trusted source. For wiring and failure details, see
the [data flow](phantom-wire-data-flow.md); for more on verification, see the
[example caveats](phantom-wire-example-caveats.md).
