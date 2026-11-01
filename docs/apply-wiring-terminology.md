# Apply wiring terminology in the changelogs

This glossary reads the `stack apply` entries in the [root changelog](../CHANGELOG.md)
and the [site changelog data](../packages/site/src/data/CHANGELOG.md). It describes
what those checked-in entries say, not a deployed site or an installed version.
Other commands' `--apply` options have their own meanings. Check the changelog
and `stack apply --help` for the version you use.

| Term in the entries | Meaning in this context |
| --- | --- |
| Recipe / provider | A recipe is a saved selection of providers; `stack apply [recipe-id]` runs the `stack add` pipeline for each provider in it. |
| Provider setup | The provider's `stack add` workflow, which may separately store real credentials. It is distinct from the later wiring step. |
| Wiring | The step that checks declared secret names in Phantom and can create webhook stubs. After at least one provider succeeds, it considers every provider in the recipe, including failed providers. |
| Secret name / real value | A name identifies an entry in Phantom; the value is the credential supplied by the user or provider setup. The wiring check looks at names and does not fill in values. |
| Placeholder / `TODO_STACK_APPLY` | A dummy value that earlier wiring attempted to write for each declared secret. Those calls failed. The 0.2.1 fix removed the attempts; wiring does not write placeholders or other values to the vault. |
| `present` / `missing` | `WireResult` fields replacing the old `envelopes` field. They distinguish declared names found or not found when the vault is readable. A required missing value still needs user action: run `phantom add <NAME>` in a trusted terminal and enter the real value. |
| `envelopes` | The old reported count from placeholder-add attempts; the 0.2.1 entry says it was always zero because those attempts failed. It is not the current present or missing count. |
| `skipped` | A report of providers whose names were not classified, including when the vault is unreadable or a provider is unknown. It does not mean their secrets are missing or present. |
| Webhook stub / `webhooks` | A stub is a generated webhook example; the entries name Stripe, Clerk, Supabase and GitHub. `webhooks` is the summary count. Stubs can be created even when the vault is unreadable. See the [stub review](phantom-wire-review.md) for their limitations. |
| `--noWire` | The opt-out from wiring: it skips both the secret-name check and webhook stubs, and prints no wiring summary. |
| Applied / provider failure | A missing name alone does not fail apply, so an applied recipe does not prove all required secrets are present. Provider failures do fail apply, even though later providers are tried. |

The output label `secrets in vault` refers to the reported present count; it
is not a count of every secret in the vault. In the unreadable-vault example,
zero present and missing counts cover only checked names: they do not prove
the vault is empty or complete. For examples of the underlying results, see
[terminology with examples](apply-terminology-examples.md).

## Wording comparison

The apply entries in the two checked-in changelog files currently match, so there
are **no wording differences between their apply entries**. This comparison does
not establish what a deployed site serves. Within each copy, the entries use
different levels of detail and describe a historical change:

| Entry in both files | Wording and context |
| --- | --- |
| Unreleased → Changed | Explicitly says wiring covers failed recipe providers after at least one success, and stubs can be created with an unreadable vault. |
| 0.3.0 → Changed and fixed / Changed | Uses “existing secret names” and “missing secret names”; the longer entry gives output examples and explains that skipped providers do not establish missing or present values. |
| 0.2.2 → Bug fixes | Describes resolving a missing recipe before initialization and continuing through provider failures, rather than the wiring inventory. |
| 0.2.1 → Bug fixes | Calls the old dummy value a placeholder, describes the failed attempts and replaces `envelopes` with `present` and `missing`. |
| 0.1.0 → AI recommendation layer | Describes the recipe command, wiring and webhook providers; this entry incorporates the later 0.2.1 fix, so it should not be read as a standalone account of the original behavior. |

The shorter phrases “missing secrets,” “missing names” and “missing values”
refer to related but distinct things: wiring reports absent names, while the
user must supply the corresponding real values when required. A readable name
inventory alone does not establish that a credential works.
