# Phantom wire verification comment context

The `TODO(security)` in [`phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts)
belongs to the webhook handler example inside `webhookStubFor`. That function
returns a template string; `writeWebhookStub` writes it to
`.stack/webhooks/<provider>.ts` for Stripe, Clerk, Supabase, and GitHub. Every
line of the generated example is commented out. Wiring writes a file, not a
registered or deployed endpoint, and rerunning it overwrites an existing stub.

Inside the example, the TODO follows `req.text()` and precedes the placeholder
200 response. It instructs the future handler author to implement
provider-specific signature verification using the webhook secret and exact
body required by the provider, reject invalid signatures, and only then trust
or act on the payload. The provider hints in the template are pointers, not
verification calls. Follow the current documentation for the particular
webhook product, including required headers and any timestamp or replay checks;
the example's `req.text()` alone does not establish preservation of exact raw
bytes. Use the provider's supported verifier where available, or a constant-time
comparison when implementing a MAC check directly.

No signature verification is performed by the generated file. Even if the
handler lines are uncommented, the TODO remains a comment: a missing or empty
signature header returns 400, while any non-empty header reaches the 200
response if the body read succeeds. The header's presence authenticates neither
sender nor payload, so the body remains attacker-controlled. Implement and test
verification before deploying a handler or acting on its contents.

The suggested `phantom reveal` command is also commented guidance, not a
command run by wiring. The vault check inventories secret names; it does not
retrieve a webhook secret or validate its value. Recipe manifests have a
separate limitation: they are unsigned, and catalog provider checks do not
authenticate their origin or integrity. See the
[comment inventory](phantom-wire-comment-inventory.md) and
[verification follow-up](phantom-wire-followup.md) for more context.
