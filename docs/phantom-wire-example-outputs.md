# Phantom wire example outputs

[`wirePhantomForRecipe`](../packages/core/src/ai/phantom-wire.ts) emits two
observable outputs: a `WireResult` — summarized by `stack apply` — and fully
commented webhook examples written under `.stack/webhooks/`. Every output is
an observation about names, files, or placeholder responses. None of them
indicates that a signature was verified, a secret value was checked, or a
handler was deployed.

## The wiring result

`WireResult` carries four arrays, in recipe and catalog order, without
deduplication:

| Field | What each entry is | What an entry does not establish |
| --- | --- | --- |
| `present` | A `provider:SECRET_NAME` catalog name that appears in the `phantom list --json` inventory. | That the stored value is valid, current, or usable; only the name was read. |
| `missing` | A `provider:SECRET_NAME` catalog name absent from the inventory. | A failure — apply proceeds. Store the real value with `phantom add <NAME>`; wiring never writes it. |
| `webhooks` | An absolute path to each generated `.stack/webhooks/<provider>.ts`. | That a route is registered or a handler deployed; the file is comment text only. |
| `skipped` | A provider whose vault check did not run: Phantom not installed, inventory unreadable, or name not in the catalog. | That its secrets are present or absent; treat skipped as unknown. |

`stack apply` prints these counts on one line, then names the missing secrets
and skipped providers:

```text
  secrets in vault 1 · missing 1 · webhooks 2 · skipped 1
  (not in Phantom: GITHUB_TOKEN — store with `phantom add <NAME>`)
  (phantom-wire skipped: unknown)
```

The `skipped` segment and both parenthesized lines appear only when
non-empty. A `phantom-wire failed: <message>` warning means the call rejected —
a stub write can fail after earlier files were already written, so partial
output may remain. With `--no-wire` nothing is printed and no file is
written; the call returns four empty arrays.

## The generated files

One file per supported provider lands at `.stack/webhooks/<provider>.ts`,
overwriting any existing file at that path. Every line is `//`-prefixed or
blank; the `phantom reveal` secret name and the provider-specific verification
hint are comments, not executed steps.

| Provider | Header read by the example | Secret named in comments |
| --- | --- | --- |
| Stripe | `stripe-signature` | `STRIPE_WEBHOOK_SECRET` |
| Clerk | `svix-signature` | `CLERK_WEBHOOK_SECRET` |
| Supabase | `x-supabase-signature` | `SUPABASE_WEBHOOK_SECRET` |
| GitHub | `x-hub-signature-256` | `GITHUB_WEBHOOK_SECRET` |

Providers outside this set (for example `neon`) contribute `present`/`missing`
entries but no stub, and an unknown catalog name contributes only a `skipped`
entry.

## Observable behavior of the example handler

Because every line is commented, the handler produces no output at all until
someone uncomments it. If it is uncommented exactly as generated:

| Input | Observable response |
| --- | --- |
| Missing or empty signature header | `Missing signature`, status 400 — returned before `req.text()` runs, so the body is never read. |
| Any non-empty signature header, body read succeeds | `ok`, status 200 — reached by any value, including a forged one. The header is never compared to anything. |
| Any non-empty signature header, body read fails | The handler rejects; no `Response` is produced. |

The `TODO(security): signature verification is NOT implemented here.` comment
sits between the body read and the 200 response. It stays comment text even
after uncommenting: signature verification is not implemented, so the 200
output does not authenticate the sender or the payload, and the body remains
attacker-controlled input. Do not deploy or act on the example as-is.

## Documented limitations

- **No verification occurs anywhere.** Generating the stub, finding a name in
  the inventory, or receiving a non-empty header authenticates nothing.
- **Names, not values.** The inventory is names-only; wiring runs
  `phantom list --json` and never calls `phantom add` or `phantom reveal`.
- **Overwrite.** Re-running wiring replaces an existing stub; preserve custom
  work before re-applying.
- **Unsigned recipes.** Recipe manifests are unsigned: matching provider names
  against the catalog does not authenticate a recipe's origin or integrity.
  Use recipes from a trusted source.
- **Counts are scoped.** `secrets in vault` counts only the catalog names
  checked, not the vault's total, and `skipped` providers contribute no
  present or missing entries.

Before deploying a real handler, implement the provider's current documented
verification scheme for the specific webhook product: preserve the required
raw body, securely retrieve the correct secret, reject missing, invalid, or
stale signatures before parsing or acting on the payload, and include required
timestamp and replay checks. The generated hints are starting points, not
verification code. See the [data flow](phantom-wire-data-flow.md) for the full
decision path, the [signature status](phantom-wire-signature-status.md) for the
TODO's scope, and the [example caveats](phantom-wire-example-caveats.md) for
what to implement first.
