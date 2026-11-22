# Phantom wire signature review

**Status: not implemented — a future step.** The only signature-verification
work item in
[`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts)
is the `TODO(security)` comment that `webhookStubFor` embeds inside each
generated webhook example. It is a future concern for whoever deploys a
handler, not a defect in code that runs today: no code path in the module
computes, compares, or checks a signature, and none is supposed to.

This review locates every signature-related statement in the module and
classifies it as **active behavior** (code that runs when
`wirePhantomForRecipe` executes) or **commented follow-up** (text emitted for a
human to act on later). It replaces the former signature note, signature
status and verification follow-up pages; the resolution criteria are in
[Resolving the follow-up](#resolving-the-follow-up). For result shapes, skipped
cases, and error paths see the [boundary review](phantom-wire-boundary.md); for
the broader trust limitations see the
[verification review](phantom-wire-review.md) and
[wiring status](phantom-wiring-status.md).

## The commented signature-verification follow-up

The TODO sits inside the generated example immediately after the request body
is read and before the success response. This excerpt is **source context**,
not a working verifier:

```ts
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything.
```

It is a follow-up in two senses and inert in both:

- It lives inside an example handler that is itself entirely comments — every
  generated line of `.stack/webhooks/<provider>.ts` is `//`-prefixed or blank —
  so it describes work for whoever deploys a handler, not a step in any program
  Stack runs.
- It stays a comment even after the example is activated. Uncommenting the
  handler does not turn the TODO into code; the runnable lines still contain no
  verification call, MAC computation, or comparison.

The rest of the TODO tells the implementer what verification must do before the
body is trusted — verify over the exact raw body bytes with the webhook secret
(`phantom reveal <PROVIDER>_WEBHOOK_SECRET`), compare in constant time, and
reject missing or invalid signatures before parsing — followed by a per-provider
hint naming the documented scheme. All of it is comment text:

| Provider | Header the example reads | Secret the example names | Verification hint (comment text) |
| --- | --- | --- | --- |
| Stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` | `stripe.webhooks.constructEvent` |
| Clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` | `new Webhook(secret).verify(body, headers)` |
| Supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` | `x-supabase-signature` per Supabase's documented scheme |
| GitHub | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` | `sha256=` + HMAC-SHA256 of the raw body |

Resolving the TODO means implementing the provider's documented scheme before
any generated handler is deployed. Nothing in `wirePhantomForRecipe` itself is
unsafe: it inventories secret **names** only and never reads values.

## Active behavior

No code path in this module computes, compares, or checks a signature or MAC,
and no secret value is ever read. What actually executes during wiring:

- `assertPhantomInstalled()` probes for the Phantom binary.
- `listSecrets` runs `phantom list --json` and reads secret **names** and
  metadata only; values are never requested, revealed, or validated.
- `writeWebhookStub` creates `.stack/webhooks/` and writes the commented example
  files above (overwriting existing files). This is the only signature-adjacent
  output — nothing registers a route, starts a listener, or authenticates a
  request.
- `signatureHeaderFor`, `webhookSecretKeyFor`, and `verificationHintFor` only
  produce strings interpolated into the stub's comment text.
- `noWire` returns early with four empty arrays; `skipped` records providers
  whose inventory could not be classified.

## Scope of the generated example

Wiring writes the example for `stripe`, `clerk`, `supabase`, and `github` only;
other catalog providers get no stub, and `--noWire` skips stub generation
entirely. Each file lands at `.stack/webhooks/<provider>.ts`, **overwriting**
any existing file at that path.

What the example covers, if someone turns it into code:

- Declares a provider-named handler, `handle<Provider>Webhook(req: Request)`,
  returning a `Response`.
- Reads the provider's signature header and returns `Missing signature` with
  status 400 when it is absent or empty, before the body is read.
- Reads the request body with `await req.text()`, then reaches the TODO.
- Returns `ok` with status 200.

What the example does not cover:

- **Secret retrieval.** The `phantom reveal` line is a comment naming which
  vault key to use at request time; generating the file runs no command and
  reads no secret value.
- **Verification.** No signature, MAC, timestamp, or replay check exists
  anywhere in the example — that is exactly the future step the TODO marks.
- **Endpoint registration or deployment.** Writing the file registers no route
  and starts no listener; the stub's existence does not prove requests are
  authenticated.

If the handler is uncommented as generated, any non-empty value for the
expected header reaches the 200 response once the body read succeeds: neither
sender nor payload is authenticated, and the body is attacker-controlled.
Treat the body as untrusted until the provider's documented verification is
implemented; see [phantom-wire-review.md](phantom-wire-review.md) for the
deployment guidance.

## Resolving the follow-up

**Status: unresolved.** The TODO stays open until verification is implemented
in every handler someone actually deploys. A vault inventory only checks secret
names; it does not retrieve or validate a webhook secret. For each deployed
handler:

1. Follow the provider's current documentation for the relevant webhook product,
   including its required headers, secret, and timestamp or replay checks. The
   hints in the table above are starting points, not verification.
2. Preserve the exact raw body the provider requires and verify it before
   parsing, trusting, or acting on the payload. Reject missing, malformed,
   invalid, or stale signatures as the provider requires. Use a supported
   verification library where one exists; if you implement a MAC check
   directly, compare in constant time. The example's `req.text()` alone does
   not establish that the exact raw bytes are preserved.
3. Test valid and invalid signatures, altered bodies, missing headers, and any
   required timestamp or replay handling for that provider. Do not mark the
   follow-up resolved merely because a header is present or a stub is
   generated.

## The other unsigned surface: recipe manifests

A second "signature verification is not implemented" statement appears in the
module docstring, about recipe files rather than webhooks: manifests are
unsigned, and checking provider names against the catalog authenticates neither
a recipe's origin nor its integrity. Unlike the webhook follow-up, no `TODO`
marks future work here — it is a stated limitation of the recipe trust model
(`readRecipe` validates structure and provider names only). Use recipes from a
trusted source.
