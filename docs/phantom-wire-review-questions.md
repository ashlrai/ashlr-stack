# Phantom wire review questions

These questions are for a design and security review of the current
[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) boundary.
They identify decisions to investigate, not a proposed protocol or a claim
that verification is already in place. A recipe manifest and a webhook request
are separate inputs with separate origins and trust decisions.

## Message origin

The wire function receives a `Recipe` and uses its provider names; it does not
authenticate the recipe. [`readRecipe`](../packages/core/src/ai/recipe.ts)
checks the local file's shape and catalog names, but the manifest is unsigned.
The generated webhook example accepts a `Request` if activated; generation
itself neither registers an endpoint nor establishes who sent a request.

- Where can recipes originate, who can modify them between creation and
  application, and who decides whether a source is trusted?
- What origin and integrity evidence, if any, is needed for a recipe before
  provisioning or wiring, including for direct callers that bypass `readRecipe`?
- For each intended webhook deployment, which external service and event source
  is expected, and who owns the configuration that connects it to the handler?
- How will reviewers distinguish a generated local example from an active
  endpoint and identify the trust boundary for incoming request bodies?

## Verification

[`webhookStubFor`](../packages/core/src/ai/phantom-wire.ts) emits a fully
commented example and verification TODO. If uncommented as generated, the
example checks only that the named header is non-empty, reads the body, and
returns 200; it does not compare the signature or authenticate the body.
`listVaultNames` checks secret names, not their values or usability. The secret
named in a stub need not be one of the catalog names checked by wiring.

- What evidence would establish the sender and integrity of a request for the
  specific provider and webhook product being used?
- What exact request data, headers, secret material, and provider requirements
  must be available to a verifier, and how will raw input be preserved until
  that decision is made?
- What freshness or replay expectations apply, and how will their applicability
  be confirmed for each provider rather than inferred from a header name?
- How will a handler distinguish a secret name appearing in inventory from a
  usable verification secret, and how will it behave when the value is unavailable?
- At what point may downstream code parse or act on a body, and how will tests
  establish that invalid or unverifiable requests cannot reach that point?

### Provider-specific inputs to confirm

The header and secret names below are what the generated examples name, not
proof that they are sufficient or correct for a particular webhook product.
Confirm each integration against the provider's current documentation.

| Example | Header | Secret named | Question for the integration owner |
| --- | --- | --- | --- |
| stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` | Which endpoint secret, raw payload representation, timestamp tolerance, and supported verification library apply? |
| clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` | Which additional Svix headers, signing secret, raw payload, and replay window does this endpoint require? |
| supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` | Does the specific Supabase webhook product actually provide this header and signing scheme, and where is its verification documented? |
| github | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` | Which webhook secret and exact body bytes must be used, and how will the `sha256=` digest be compared safely? |

## Example status

[`writeWebhookStub` and `webhookStubFor`](../packages/core/src/ai/phantom-wire.ts)
produce fully commented files, not registered or deployed endpoints. If the
example handler is uncommented as written, it returns 400 for a missing or
empty expected header and, after reading the body, returns 200 for any non-empty
header without verifying it. A body-read error rejects the handler instead of
returning that success response. A generated stub and a successful inventory
check therefore do not establish that a webhook is operational or trusted.

- Who owns converting each example into a handler and verifying that the
  deployed route uses that handler rather than the unmodified example?
- What review and tests must pass before the example can be described as
  production-ready, including forged signatures, altered bodies and unavailable
  verification inputs?
- How will operators tell a generated file from a configured, registered,
  deployed, and successfully verified endpoint?
- How will repeated wiring avoid losing an owner-maintained handler when the
  generated path is overwritten?

## Failure handling

In [`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts), a missing
Phantom installation skips every provider but still writes supported stubs;
other installation errors propagate. Inventory errors become an unknown
inventory, recorded as `skipped` rather than `missing`. Stub writes overwrite
existing files, and a later write failure can leave earlier files in place.
The [`apply` caller](../packages/cli/src/commands/apply.ts) wires the entire
recipe after at least one provider succeeds and reports a rejected wire call as
a warning.

- How should a caller distinguish missing secrets from unchecked providers,
  and what action is expected when Phantom or its inventory is unavailable?
- Which errors should stop an apply or deployment, and which can remain warnings,
  given that provisioning may already have succeeded?
- How should an operator discover and recover from partially written stubs or
  an existing handler overwritten by a subsequent wiring run?
- How should a future active handler respond to absent, malformed, invalid, or
  unverifiable signatures, body-read errors, and unavailable secrets?
- What should happen when wiring is disabled with `noWire`, or when only some
  providers provision successfully but wiring receives the whole recipe?
