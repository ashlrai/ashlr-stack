# Reader glossary: `stack apply` changelog notes

This guide explains the apply notes in the [repository changelog](../CHANGELOG.md)
(and especially its [0.2.1 fix](../CHANGELOG.md#021-2026-10-16)) and the
[site's checked-in changelog](../packages/site/src/data/CHANGELOG.md) (including
[the same fix](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)). The
copies currently match; they describe source history, not proof of an installed
version or a deployed site. Check the changelog and `stack apply --help` for
what you actually run.

| Term | Meaning in these notes |
| --- | --- |
| Recipe / provider | A recipe is a saved selection of services. `stack apply [recipe-id]` runs the `stack add` setup pipeline for each provider. |
| Provider setup | The individual provider's setup workflow; it may store real credentials separately from wiring. Apply tries later providers after a failure and reports provider failures at the end. |
| Wiring / Phantom vault | After at least one provider succeeds, wiring checks declared secret names in the project's Phantom Secrets vault and may create webhook stubs. It considers every recipe provider, including failed providers. If no provider succeeds, wiring does not run. |
| Secret name / value | The name identifies a credential; the value is the actual credential. Wiring checks names, not the validity of values, and does not fill in missing values. A required missing value needs user action: run `phantom add <NAME>` in a trusted terminal and enter the real value there. |
| Placeholder / `TODO_STACK_APPLY` | A dummy value that older wiring tried to add for each declared secret. Phantom rejected those attempts; the 0.2.1 fix removed them. Wiring does not write placeholder or real values to the vault. |
| `present` / `missing` | The current `WireResult` lists of provider-and-secret-name entries found or absent in a readable vault. The CLI's `secrets in vault` and `missing` counts describe those checked entries, not the entire vault; a shared name can be counted for more than one provider. A present name does not prove its credential is valid; a missing name alone does not fail apply. |
| `envelopes` | The old `WireResult` field and count, replaced by `present` and `missing`. The changelog says the old count was always zero because the placeholder-add attempts failed; it was not a count of usable credentials. |
| `skipped` | Provider names whose secret names were not classified, for example because the vault was unreadable or the provider was unknown. Zero present and missing counts in this case do not establish that the vault is empty or complete. |
| Webhook stub / `webhooks` | A generated example handler file for a supported provider (Stripe, Clerk, Supabase or GitHub); the summary counts generated files. Stubs can be created even when the vault is unreadable or the provider failed. The generated `.stack/webhooks/<provider>.ts` file overwrites an existing file at that path. Stubs do not implement signature verification and require work before deployment. |
| `--noWire` | An apply option that skips both the vault check and webhook stubs; no wiring summary is printed. It does not suppress provider failures. |
| Applied / failure | A successful apply does not prove all required secrets are present. Missing names alone do not fail apply, but provider failures do. Check both the provider outcome and wiring report. |

For the two example reports and their interpretation, see the
[reader guide](changelog-apply-reader-guide.md). For the stub's trust boundary,
see [webhook stub review](phantom-wire-review.md).
