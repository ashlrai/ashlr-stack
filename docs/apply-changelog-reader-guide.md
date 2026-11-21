# Reader guide: finding the `stack apply` change in the changelogs

Start here if you want the documented `stack apply` change and do not know which file or heading holds it. Two checked-in files carry it: the repository [CHANGELOG.md](../CHANGELOG.md) and the site copy [packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md), which the site renders. They are byte-for-byte identical in this checkout, so either link reaches the same text. This guide describes those files, not an installed version or a deployed site; run `stack apply --help` for the version you use.

## The change in one paragraph

`stack apply` no longer attempts to write placeholder secrets. Its wiring step checks declared secret names against Phantom instead of writing to the vault or filling in missing values. Provider setup is separate and may store real credentials. Each required missing value needs user action: run `phantom add <NAME>` from a trusted terminal and enter the real value.

## Where to read it

| You want | Open | Entry |
| --- | --- | --- |
| The fix and why it was needed | [0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16) · [site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | First bullet under the first **Bug fixes** heading: "`stack apply` stops attempting to write placeholder secrets." |
| The current behavior | [Unreleased](../CHANGELOG.md#unreleased) · [site copy](../packages/site/src/data/CHANGELOG.md#unreleased) | **Changed**: "`stack apply` does not create placeholder secrets." |
| Vault output and unreadable-vault handling | [0.3.0 (2026-10-31)](../CHANGELOG.md#030-2026-10-31) · [site copy](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) | **Changed and fixed**, plus the detailed **Changed** entry |
| The original command description | [0.1.0 — 2026-04-19](../CHANGELOG.md#010--2026-04-19-superseded-by-011) · [site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) | **AI recommendation layer**, annotated with the history |

The 0.2.1 release has a second **Bug fixes** heading under "Earlier 0.2.1 notes (2026-10-12)", so link to the release anchor, not the subsection name. Related but different `stack apply` fixes (a missing recipe writes nothing; a failed provider no longer stops later ones) are under [0.2.2](../CHANGELOG.md#022-2026-10-25) ([site copy](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)). For other `stack apply` changes, see [changelog source locations](changelog-source-locations.md).

## Exact locations

Release headings and subheadings repeat (`Changed` and `Bug fixes` occur in several releases), so find an entry by its release heading first, then by the bullet's opening words. Both files list each entry under the same release heading, subheading and bullet.

| Release heading | Subheading | Bullet starts with |
| --- | --- | --- |
| `Unreleased` | `Changed` | `stack apply` does not create placeholder secrets. |
| `0.3.0 (2026-10-31)` | `Changed and fixed` | Apply wiring checks existing secret names without storing placeholders; |
| `0.3.0 (2026-10-31)` | `Changed` (second occurrence) | After at least one provider succeeds, `stack apply` wiring checks |
| `0.2.1 (2026-10-16)` | `Bug fixes` (the first of two) | **`stack apply` stops attempting to write placeholder secrets.** |
| `0.1.0 — 2026-04-19 (superseded by 0.1.1)` | `AI recommendation layer` | **`stack apply [recipe-id]`** (annotated with the later change) |

- The 0.2.1 bullet is the original record of the fix: the first bullet under that release's first **Bug fixes** heading. The other entries restate or extend it.
- The two files match line for line, so each bullet sits at the same line number in both. `packages/site/tests/changelog.test.ts` guards the copy.
- 0.2.1 is the version recorded for the change, not proof of what is installed or deployed. The [0.2.2 release notes](../CHANGELOG.md#022-2026-10-25) say 0.2.1 was tagged but its npm publish failed, and 0.2.2 includes its changes.

## Release by release

The site copies the root file during its content sync, so each row links the same heading in both files. Read the rows in order.

| Version heading and source | What a reader should take away |
| --- | --- |
| `0.1.0 — 2026-04-19 (superseded by 0.1.1)` — [root](../CHANGELOG.md#010--2026-04-19-superseded-by-011) · [site](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) | The AI recommendation layer introduces `stack apply` and its wiring. The entry is annotated with later knowledge: placeholder writes were attempted historically, those calls failed, and the 0.2.1 fix removed the attempts. Do not read the current wording as an unchanged description from 0.1.0. |
| `0.2.1 (2026-10-16)` — [root](../CHANGELOG.md#021-2026-10-16) · [site](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | Under **Bug fixes**, wiring stops attempting placeholder writes. Phantom rejected values in arguments and did not support the old `--rotate` flag, so every attempt failed and the reported `envelopes` count was always zero. The result fields changed from `envelopes` to `present` and `missing`. |
| `0.2.2 (2026-10-25)` — [root](../CHANGELOG.md#022-2026-10-25) · [site](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) | The release note says 0.2.1 was tagged but its npm publish failed; 0.2.2 supersedes it and includes the changes listed under 0.2.1. |
| `0.3.0 (2026-10-31)` — [root](../CHANGELOG.md#030-2026-10-31) · [site](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) | The **Changed** notes explain that wiring checks secret names without filling missing values. A readable vault yields missing-name information; an unreadable vault yields skipped providers, not a list of missing names. Provider setup may separately store real credentials. |
| `Unreleased` — [root](../CHANGELOG.md#unreleased) · [site](../packages/site/src/data/CHANGELOG.md#unreleased) | After at least one provider succeeds, wiring checks every recipe provider, including failed providers, and can create webhook stubs even when the vault is unreadable. Missing names alone do not fail apply; provider failures do. `--noWire` skips both checks and stubs. |

For each required missing value, run `phantom add <NAME>` in a trusted terminal and enter the real value. A successful apply alone does not establish that every required secret is present.

## Limits worth knowing

- Per the Unreleased entry, a missing name does not itself fail apply, while provider failures do, and `--noWire` skips both checks and stubs.
- Wiring can create webhook stubs even if the vault is unreadable; an unreadable vault yields skipped providers, not proof that no names are missing.
- 0.2.1 was tagged but its npm publish failed; [0.2.2](../CHANGELOG.md#022-2026-10-25) supersedes it. Check the installed version before applying this history.

## Glossary

The terms below are used in the changelog entries above, in particular the 0.2.1 fix.

| Term | Meaning in these notes |
| --- | --- |
| Recipe / provider | A recipe is a saved selection of services. `stack apply [recipe-id]` runs the `stack add` setup pipeline for each provider. |
| Provider setup | The individual provider's setup workflow; it may store real credentials separately from wiring. Apply tries later providers after a failure and reports provider failures at the end. |
| Wiring / Phantom vault | After at least one provider succeeds, wiring checks declared secret names in the project's Phantom Secrets vault and may create webhook stubs. It considers every recipe provider, including failed providers. If no provider succeeds, wiring does not run. |
| Secret name / value | The name identifies a credential; the value is the actual credential. Wiring checks names, not the validity of values, and does not fill in missing values. A required missing value needs user action: run `phantom add <NAME>` in a trusted terminal and enter the real value there. |
| Placeholder / `TODO_STACK_APPLY` | A dummy value that older wiring tried to add for each declared secret. Phantom rejected those attempts; the 0.2.1 fix removed them. Wiring does not write placeholder or real values to the vault. |
| `present` | The current `WireResult` list of provider-and-secret-name entries found in a readable vault. The CLI's `secrets in vault` count describes those checked entries, not the entire vault; a shared name can be counted for more than one provider. A present name does not prove its credential is valid. |
| `missing` | The current `WireResult` list of provider-and-secret-name entries absent from a readable vault. The CLI's `missing` count describes those checked entries, not the entire vault. A missing name alone does not fail apply, and filling it in needs user action: run `phantom add <NAME>` in a trusted terminal. |
| `envelopes` | The old `WireResult` field and count, replaced by `present` and `missing`. The changelog says the old count was always zero because the placeholder-add attempts failed; it was not a count of usable credentials. |
| `skipped` | Provider names whose secret names were not classified, for example because the vault was unreadable or the provider was unknown. Zero present and missing counts in this case do not establish that the vault is empty or complete. |
| Webhook stub / `webhooks` | A generated example handler file for a supported provider (Stripe, Clerk, Supabase or GitHub); the summary counts generated files. Stubs can be created even when the vault is unreadable or the provider failed. The generated `.stack/webhooks/<provider>.ts` file overwrites an existing file at that path. Stubs do not implement signature verification and require work before deployment. |
| `--noWire` | An apply option that skips both the vault check and webhook stubs; no wiring summary is printed. It does not suppress provider failures. |
| Applied / failure | A successful apply does not prove all required secrets are present. Missing names alone do not fail apply, but provider failures do. Check both the provider outcome and wiring report. |

For the stub's trust boundary, see [webhook stub review](phantom-wire-review.md).

## Verify

```bash
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts scripts/apply-changelog-reader-guide.test.ts
```

For deeper reading see the [reader FAQ](apply-changelog-reader-faq.md), the [report examples](changelog-apply-reader-guide.md), the [mirroring guide](changelog-mirroring.md#review-before-syncing) for comparing the two files, and the [apply history guide](apply-history-reader-guide.md).
