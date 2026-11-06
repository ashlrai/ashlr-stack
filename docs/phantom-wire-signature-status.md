# Phantom wire signature status

**Status: not implemented — a future step.** The only signature-verification
work item in
[`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts)
is the `TODO(security)` comment that `webhookStubFor` embeds inside each
generated webhook example. It marks deferred work for whoever deploys a
handler, not a defect in code that runs today: no code path in the module
computes, compares, or checks a signature, and every line
`wirePhantomForRecipe` writes to `.stack/webhooks/<provider>.ts` is comment
text.

The TODO sits inside the generated example immediately after the request body
is read and before the success response:

```ts
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything.
```

## Why the TODO is a future step

- It ships only as text emitted into an example file, so resolving it is work
  for a human deployer — it is not a pending step in any code path Stack
  executes.
- It stays a comment even after the example is activated. Uncommenting the
  handler adds no verification call: the runnable lines still never compute or
  compare a signature.
- The rest of the TODO states what resolving it requires before the body is
  trusted: verify over the exact raw body bytes with the webhook secret
  (`phantom reveal <PROVIDER>_WEBHOOK_SECRET`), compare in constant time, and
  reject missing or invalid signatures before parsing. A per-provider hint
  names the documented verification scheme to start from; it is comment text,
  not an implementation.

## Scope of the surrounding example

The example the TODO lives in is deliberately narrow. Wiring writes it for
`stripe`, `clerk`, `supabase`, and `github` only; other catalog providers get
no stub, and `--no-wire` skips stub generation entirely. Each file lands at
`.stack/webhooks/<provider>.ts`, **overwriting** any existing file at that
path, and every generated line is `//`-prefixed or blank.

What the example covers, if someone turns it into code:

- Declares a provider-named handler, `handle<Provider>Webhook(req: Request)`,
  returning a `Response`.
- Reads the provider's signature header and returns `Missing signature` with
  status 400 when it is absent or empty.
- Reads the request body with `await req.text()`, then reaches the TODO.
- Returns `ok` with status 200.

| Provider | Header read | Secret named in comment |
| --- | --- | --- |
| Stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` |
| Clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` |
| Supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` |
| GitHub | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` |

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
implemented — see the [verification follow-up](phantom-wire-followup.md) for
resolution criteria.

Recipe manifests carry a separate limitation: they are unsigned, and checking
provider names against the catalog authenticates neither origin nor integrity.
For both signature statements classified, see the
[signature review](phantom-wire-signature-review.md); for wiring behavior and
failure cases, see the [boundary review](phantom-wire-boundary.md) and
[wiring status](phantom-wiring-status.md).
