# Phantom wire signature-verification follow-up

**Status: unresolved.** The `TODO(security)` in
[`webhookStubFor`](../packages/core/src/ai/phantom-wire.ts) says signature
verification is not implemented. It is part of a template in the source, not
an implemented security control. `wirePhantomForRecipe` writes that template
as a fully commented example at `.stack/webhooks/<provider>.ts` for `stripe`,
`clerk`, `supabase`, and `github`. It does not register or deploy a handler.

The surrounding example reads the provider's signature header, rejects a
missing or empty value, reads the request body, and then reaches the TODO before
returning 200. This excerpt is **source context**, not a working verifier:

```ts
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything.
```

Every line in the generated file is commented out. If the handler is
uncommented as written, any non-empty header reaches the success response
without authenticating the sender or body. The body is attacker-controlled;
do not deploy or act on it until verification is implemented. A vault inventory
only checks secret names and does not retrieve or validate a webhook secret.

## Work needed to resolve the TODO

For each handler actually deployed:

1. Follow the provider's current documentation for the relevant webhook product,
   including its required headers, secret, and timestamp or replay checks. The
   provider-specific hints in the template are starting points, not verification.
2. Preserve the exact raw body required by the provider and verify it before
   parsing, trusting, or acting on the payload. Reject missing, malformed, invalid,
   or stale signatures as required by the provider. Use a supported verification
   library where available; use constant-time comparison for a MAC if implementing
   it directly. The example's `req.text()` alone does not establish that exact
   raw bytes are preserved.
3. Test valid and invalid signatures, altered bodies, missing headers, and any
   required timestamp or replay handling for that provider. Do not mark this
   follow-up resolved merely because a header is present or a stub is generated.

Recipe manifests have a separate limitation: they are unsigned, and catalog
checks do not authenticate their origin or integrity. Use trusted recipes. See
the [signature review](phantom-wire-signature-review.md) for the source's
provider-specific hints and the [boundary review](phantom-wire-boundary.md) for
wiring behavior and failure cases.
