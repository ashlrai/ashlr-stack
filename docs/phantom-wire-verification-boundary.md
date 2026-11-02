# Phantom wire verification boundary

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) generates a
commented webhook example at `.stack/webhooks/<provider>.ts` for Stripe,
Clerk, Supabase, and GitHub. It writes a file, not a registered or deployed
endpoint; a later wiring run overwrites the file at that path.

The verification placeholder in `webhookStubFor` appears after the body read
and before the success response in every generated example:

```ts
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything. Until this TODO is done, `body`
```

**The example itself does not implement signature verification.** All of its
lines are comments, including the provider-specific verification hint and the
suggestion to retrieve a secret from Phantom. Generating the file does not
retrieve a secret or authenticate a request. Checking that a vault secret name
is present is only an inventory check, not proof that its value is correct or
that the webhook uses it.

If the handler is uncommented unchanged, an absent or empty signature header
returns 400. Any non-empty value reaches `ok`/200 if the body read succeeds:
the signature is never compared, and the body remains unauthenticated,
attacker-controlled input. A body-read failure rejects the handler. Do not
deploy the example as-is or act on its body.

Before using a derived handler, confirm the current signing scheme and required
headers for the specific provider product. Securely obtain its signing secret,
preserve the exact signed bytes, and use the provider's supported verifier or
the documented scheme with a constant-time comparison. Reject missing, invalid,
and applicable stale or replayed requests before parsing or acting on the
body. Test valid signatures, forged signatures, changed bodies, missing
headers, and applicable freshness and replay cases. The generated hints are
starting points, not evidence that a scheme applies to a particular product.

Recipe manifests have a separate verification boundary: they are unsigned,
and catalog name checks do not authenticate their origin or integrity. Use
recipes from a trusted source. See the [verification questions](phantom-wire-verification-questions.md)
and [wiring boundary](phantom-wire-boundary.md) for integration and inventory details.
