# Reading the Phantom wire example

[`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts) generates webhook
stub files for Stripe, Clerk, Supabase, and GitHub recipe providers. Read
`webhookStubFor` in that source for the example and `verificationHintFor` for
the provider-specific reminders. The generated file is entirely commented out;
generating it does not install a route or verify a request.

Inside the example, the `TODO(security)` immediately follows the body read:

> TODO(security): signature verification is NOT implemented here.

That is a reminder to implement verification, not an assertion that it has
occurred. The example checks only whether the signature header is non-empty;
it never compares its value with a signature computed from the body and secret.
The body is unauthenticated, attacker-controlled input. If uncommented as
written, a request with any non-empty signature header reaches the 200 response
when the body read succeeds.

Before deploying a handler, implement the provider's current verification
scheme, preserve the body as required by that scheme, and reject invalid
requests before parsing, trusting, or acting on them. The source's hints and
secret-retrieval comments are starting points, not executable verification. The
separate recipe manifest is also unsigned; use recipes from a trusted source.

For a longer walkthrough, see the [example reading guide](phantom-wire-example-reading-guide.md).
