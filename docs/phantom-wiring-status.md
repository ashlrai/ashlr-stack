# Phantom wiring status

This describes the current source behavior of [`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts), used by `stack apply` after at least one provider has been provisioned. It is an inventory check and example generator, not a verification or deployment mechanism. If provisioning partly succeeds, wiring receives the whole recipe, including providers that failed provisioning; its results do not prove a provider was provisioned successfully.

## Recipe trust

Recipe manifests are unsigned. Stack does not verify their origin or integrity: someone able to alter a recipe can change its contents before it is applied. Reading a local recipe checks provider names against the catalog, but a known name does not establish who authored the recipe or whether it was changed. Review recipes and use a trusted source before applying them; applying a recipe provisions its listed providers.

## Vault inventory

For each known provider, wiring compares the catalog's declared secret names with the project's `phantom list --json` inventory. It reports `present` and `missing` entries as `provider:secret-name`. A present name does not establish that its value is valid, current, usable by the provider, or available to a webhook handler. The inventory does not necessarily include every secret a custom webhook needs.

Wiring reads names and metadata, not values, and never writes placeholder or real secrets to the vault. The provider provisioning flow handles real values. If Phantom is unavailable or the inventory cannot be read, providers are reported as `skipped`, not missing; an unknown provider is also skipped. Treat skipped status as unknown, not proof that secrets are absent or present. Webhook stubs can still be created when the inventory is unavailable.

`--no-wire` skips both the inventory check and stub generation; it does not disable provider provisioning. The CLI reports wiring failures as warnings, so a completed apply alone is not evidence that wiring succeeded.

## Webhook examples

See the [verification review](phantom-wire-review.md) for the recipe and webhook trust limitations.

Wiring writes fully commented examples for Stripe, Clerk, Supabase, and GitHub to `.stack/webhooks/<provider>.ts`. These are examples only: they do not retrieve a secret or verify a signature. If uncommented as generated, a request with any non-empty expected signature header receives a 200 after its body is read. The header's presence does not authenticate the sender or payload; anyone able to reach the endpoint can forge a request.

Before deploying a handler, implement the provider's current documented verification scheme, including its required headers, exact raw request body, secret and any replay protection. Reject missing or invalid signatures before parsing, trusting, or acting on the payload. Use the provider's supported verification library where available and constant-time comparison where implementing a MAC comparison. The generated hints are starting points, not proof of a working integration; consult the provider's documentation for the actual webhook product and configuration.

Stub generation overwrites an existing file at the same path. Preserve custom work elsewhere before applying the recipe again. A stub's existence does not register a webhook endpoint, deploy a handler, or prove that requests are authenticated.
