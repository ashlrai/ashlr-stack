# Reading a Phantom wire webhook example

[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts) generates a
commented webhook example for each supported provider in a recipe. For a
Stripe entry, the file is `.stack/webhooks/stripe.ts` under the selected working
directory. Wiring creates the directory if needed and **overwrites** an existing
file at that path. It does not register a route or deploy a handler. The whole
generated example is commented out, so none of the handler steps below runs
unless someone first turns it into code. In the source, `webhookStubFor` emits
the example text and `verificationHintFor` supplies each provider's one-line
verification reminder.

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

## Source map

There is no checked-in example file to link to: the example is generated at run
time. For each recipe provider in
[`WEBHOOK_PROVIDERS`](../packages/core/src/ai/phantom-wire.ts#L46) (`stripe`,
`clerk`, `supabase`, `github`),
[`writeWebhookStub`](../packages/core/src/ai/phantom-wire.ts#L111) writes
`.stack/webhooks/<provider>.ts` with the text built by
[`webhookStubFor`](../packages/core/src/ai/phantom-wire.ts#L118). Stubs are
plain files, so they are still written when Phantom itself is missing. This map
points at the template lines in
[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts) that produce each
part of the generated example.

### The generated example

| Part of `.stack/webhooks/<provider>.ts` | Source | What it becomes in the file |
| --- | --- | --- |
| File header | [preamble template](../packages/core/src/ai/phantom-wire.ts#L119) | `` // Auto-generated by `stack apply` — webhook handler stub for <provider>. ``, then warnings that the example is commented out, does not verify signatures, and must not be deployed as-is. |
| Secret guidance | [secret comment](../packages/core/src/ai/phantom-wire.ts#L125) | A commented `phantom reveal` line naming the secret chosen by [`webhookSecretKeyFor`](../packages/core/src/ai/phantom-wire.ts#L170) (for example `STRIPE_WEBHOOK_SECRET`). Generating the file runs nothing and retrieves no value. |
| Handler skeleton | [handler template](../packages/core/src/ai/phantom-wire.ts#L128) | `handle<Provider>Webhook` — the provider name with its first letter uppercased by [`capitalize`](../packages/core/src/ai/phantom-wire.ts#L200) — reads the header named by [`signatureHeaderFor`](../packages/core/src/ai/phantom-wire.ts#L185), returns 400 when that header is missing or empty, reads the body, and returns 200. Every line stays `//`-commented in the file. |
| Verification reminder | [TODO template](../packages/core/src/ai/phantom-wire.ts#L132) | The `TODO(security)` block mapped below — the stub's reminder that signature verification is not implemented. |
| Success response | [return template](../packages/core/src/ai/phantom-wire.ts#L142) | `return new Response("ok", { status: 200 })`, which any non-empty signature header reaches if the example is uncommented without implementing verification. |

### The verification reminder

The reminder is the `TODO(security)` block emitted between the body read and
the success response. As generated for a Stripe recipe entry, it reads in full:

```ts
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
```

It has two halves in the [template](../packages/core/src/ai/phantom-wire.ts#L132):

- **The warning** — a present signature header authenticates nothing, so the
  body remains unauthenticated, attacker-controlled input until verification
  exists.
- **The pointer** — the provider-specific hint interpolated at
  [line 137](../packages/core/src/ai/phantom-wire.ts#L137) by
  [`verificationHintFor`](../packages/core/src/ai/phantom-wire.ts#L155), then the
  [closing instructions](../packages/core/src/ai/phantom-wire.ts#L138) to verify
  the exact raw body bytes with the webhook secret, compare in constant time,
  and reject missing or invalid signatures before parsing, trusting, or acting
  on the body.

The reminder stays a comment even if the surrounding handler is uncommented;
implementing it means adding the provider's current verification scheme before
deploying, not uncommenting anything.

### Verify the map

Locate the template and the reminder in the source:

```sh
grep -n 'writeWebhookStub\|webhookStubFor\|TODO(security)' packages/core/src/ai/phantom-wire.ts
```

Expect `writeWebhookStub` near line 111, `webhookStubFor` near line 118, and the
`TODO(security)` line near line 132. The pinned check regenerates real stubs
and confirms this guide, the map and both excerpts still match:

```sh
HOME=$(mktemp -d) bun test scripts/phantom-wire-example-reading-guide.test.ts
```

For module behavior see the [code map](phantom-wire-code-map.md) and
[comment inventory](phantom-wire-comment-inventory.md); the
[signature note](phantom-wire-signature-note.md) classifies the reminder as
deferred work for the handler author.
