# Trust in Phantom wire examples

[`wirePhantomForRecipe` in phantom-wire.ts](../packages/core/src/ai/phantom-wire.ts)
creates fully commented webhook examples for Stripe, Clerk, Supabase, and GitHub
under `.stack/webhooks/<provider>.ts`. These are files, not registered routes or
running handlers. Wiring overwrites an existing file at the same path.

The `TODO(security)` in each example is **illustrative guidance, not implemented
verification**. The secret retrieval command, provider-specific hint, and
instructions to verify the raw body and compare signatures are comments. No
secret is retrieved and no signature is checked by the example. If uncommented
as written, it returns 400 for a missing or empty signature header; any non-empty
header reaches the 200 response if the body read succeeds. That response does
not authenticate the sender or payload. Until verification succeeds, the body
is attacker-controlled input; do not deploy or act on the example as-is.

The separate Phantom vault check inventories catalog secret names, not secret
values. A present name does not prove a secret is valid or that a webhook was
verified, and the secret named in the stub may differ from the catalog names.
Recipe manifests are also unsigned: checking provider names against the catalog
does not authenticate a recipe's origin or integrity. Use trusted recipes.

Before deploying a handler, implement the current verification scheme for the
provider's specific webhook product. Securely retrieve the correct secret,
preserve the required raw body and headers, and reject invalid or stale
requests before parsing or acting on them. Include required timestamp and
replay checks, and use a supported verifier or constant-time MAC comparison
where appropriate. Test valid and invalid signatures, altered bodies, missing
headers, and applicable timestamp and replay cases. The generated hints are
starting points, not proof that a scheme applies to every webhook product.
