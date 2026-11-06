# Phantom wire signature-verification note

**Classification: future concern.** The only signature-verification work item in
[`packages/core/src/ai/phantom-wire.ts`](../packages/core/src/ai/phantom-wire.ts)
is a comment — the `TODO(security)` that `webhookStubFor` embeds inside each
generated webhook example. It is deferred work for whoever deploys a handler,
not a defect in code that runs today: no code path in the module computes,
compares, or checks a signature, and none is supposed to.

## The TODO

`wirePhantomForRecipe` writes a fully commented example to
`.stack/webhooks/<provider>.ts` for `stripe`, `clerk`, `supabase`, and `github`.
Every generated line is `//`-prefixed or blank. Inside that example, immediately
after the request body is read:

```ts
//   const body = await req.text();
//   // TODO(security): signature verification is NOT implemented here. The
//   // header check above proves only that a signature header arrived; its
//   // value is never compared to anything.
```

The TODO is inert twice over:

- It ships inside an example that is entirely comments, so it describes future
  work for a human deployer — it is not a step Stack executes.
- Uncommenting the handler does not activate it. The runnable lines would still
  contain no verification call, so a handler deployed as-is accepts any
  non-empty signature header and returns 200 over an unauthenticated,
  attacker-controlled body.

## Why it is a future concern, not a current bug

The stub's contract is explicit: the file header says the example "does not
verify signatures," and the rest of the TODO tells the implementer to verify
the exact raw body bytes with the webhook secret (`phantom reveal
<PROVIDER>_WEBHOOK_SECRET`), compare in constant time, and reject missing or
invalid signatures before parsing. Resolving the TODO means implementing the
provider's documented scheme — the module already inlines a per-provider hint —
before any generated handler is deployed. Nothing in `wirePhantomForRecipe`
itself is unsafe: it inventories secret **names** only and never reads values.

The related but distinct unsigned-recipe-manifest note in the module docstring
is a stated trust limitation, not a `TODO`; see the
[signature review](phantom-wire-signature-review.md) for both statements
classified, the [follow-up](phantom-wire-followup.md) for resolution criteria,
and the [boundary review](phantom-wire-boundary.md) for runtime behavior.
