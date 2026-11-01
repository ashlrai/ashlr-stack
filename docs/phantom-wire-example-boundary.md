# Phantom wire example boundary

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) writes a
fully commented example to `.stack/webhooks/<provider>.ts` for Stripe, Clerk,
Supabase, and GitHub. It creates a file, not a route or a deployed handler, and
will overwrite an existing file at that path. The following is an excerpt from
the generated Stripe example:

```ts
//   const signature = req.headers.get("stripe-signature");
//   if (!signature) return new Response("Missing signature", { status: 400 });
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything. Until this TODO is done, `body`
```

The signature-verification line is a **TODO in an example**, not a verifier.
All of these lines are comments in the generated file and do nothing on their
own. If the handler is uncommented as written, a missing or empty header returns
400 before the body is read; any non-empty header reaches the later `ok`/200
response if the body read succeeds. A failed body read rejects the handler.

| Observation | What it establishes | What it does not establish |
| --- | --- | --- |
| A non-empty signature header is present | A caller supplied a value for that header. | The sender or body is authentic; the value is never verified. |
| The body was read and the example returned 200 | The body read completed and the placeholder returned success. | The body was signed, unchanged, safe to process, or preserved as the exact raw bytes needed for verification. |
| A catalog secret name is reported present | That name appeared in the Phantom inventory. | Its value is valid or usable, or that the webhook secret was retrieved. The stub's secret name may differ from the catalog names checked. |

Until verification succeeds, the body is unauthenticated, attacker-controlled
input. Do not deploy or act on the example as-is. Implement the current
provider-specific scheme for the webhook product, securely retrieve its secret,
preserve the required raw body and headers, and reject invalid or stale requests
before processing them. Include any required timestamp and replay checks; use a
supported verifier where available, or a constant-time MAC comparison for a
direct implementation. Test valid and invalid signatures, changed bodies,
missing headers, and applicable timestamp and replay cases. The generated hints
are starting points, not verification code.

Recipe manifests have a separate boundary: they are unsigned, and checking
provider names against the catalog does not authenticate their origin or
integrity. Use trusted recipes. See the [wiring boundary](phantom-wire-boundary.md)
for inventory and error details and the [reading guide](phantom-wire-example-reading-guide.md)
for the full example.
