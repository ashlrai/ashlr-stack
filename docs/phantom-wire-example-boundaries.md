# Phantom wire example boundaries

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) writes a
fully commented example to `.stack/webhooks/<provider>.ts` for Stripe, Clerk,
Supabase, and GitHub. The example shows a handler shape and stops one step
short: signature verification is a named TODO, not code. This page separates
the operations shown in the generated example from the verification step left
as a TODO — the two sides of the example's trust boundary.

The generated Stripe handler, verbatim (every line is a comment; nothing
runs):

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

## Operations shown in the example

These operations are written out in the file. Because every line is a comment,
none of them run — and if the handler is uncommented as written, they still do
not authenticate anything:

| Shown operation | What it does if uncommented |
| --- | --- |
| Declare `handleStripeWebhook(req: Request)` | Defines a provider-named handler returning `Promise<Response>`; it is not registered with any router or runtime. |
| `req.headers.get("stripe-signature")` | Reads the provider's signature header (`svix-signature`, `x-supabase-signature`, or `x-hub-signature-256` in the other stubs). |
| Reject `!signature` with 400 | Returns `Missing signature` when the header is absent or empty, before the body is read. A present header proves only that a value was supplied. |
| `await req.text()` | Reads the body; a failed read rejects the handler. Reading text does not by itself preserve the exact raw bytes a verification scheme requires. |
| `return new Response("ok", { status: 200 })` | Returns success to any request that passed the presence check and body read — including one carrying a forged signature value. |

## The signature-verification step left as a TODO

`TODO(security): signature verification is NOT implemented here.` sits between
the body read and the 200 response. It is a single missing step with several
required parts, and the example performs none of them:

- Retrieve the webhook secret at call time. The `phantom reveal
  STRIPE_WEBHOOK_SECRET` line is a comment; generating the file never runs it,
  and the separate vault check compares catalog secret names only.
- Verify the signature over the exact raw body bytes using that secret and the
  provider's current documented scheme. The one-line provider hint is a
  pointer to the right API, not an implementation.
- Compare in constant time, and reject missing, malformed, invalid, or stale
  signatures — including the timestamp and replay checks the scheme requires.
- Only then parse, trust, or act on the body.

| Example side (shown) | TODO side (not implemented) |
| --- | --- |
| A signature header arrived | The signature is verified against the webhook secret |
| The body was read | The raw body is authenticated before it is used |
| The request got a 200 | Forged or stale requests are rejected before processing |

Until the TODO is implemented, the body is unauthenticated,
attacker-controlled input. Do not deploy or act on the example as-is; use the
provider's supported verifier where available, and test valid and invalid
signatures, changed bodies, missing headers, and timestamp and replay cases.

Recipe manifests sit at a second boundary: they are unsigned, and checking
provider names against the catalog does not authenticate their origin or
integrity. Use trusted recipes. For what each runtime observation establishes,
see the [example boundary](phantom-wire-example-boundary.md); for a
line-by-line walkthrough, see the
[reading guide](phantom-wire-example-reading-guide.md).
