# Reader guide: finding the `stack apply` change in the changelogs

Start here if you want the documented `stack apply` change and do not know which file or heading holds it. Two checked-in files carry it: the repository [CHANGELOG.md](../CHANGELOG.md) and the site copy [packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md), which the site renders. They are byte-for-byte identical in this checkout, so either link reaches the same text. This guide describes those files, not an installed version or a deployed site; run `stack apply --help` for the version you use.

## The change in one paragraph

`stack apply` no longer attempts to write placeholder secrets. Its wiring step checks declared secret names against Phantom; in the 0.2.1 entry's words, it never writes to the vault or fills in missing values. Provider setup is separate and may store real credentials. Each required missing value needs user action: run `phantom add <NAME>` from a trusted terminal and enter the real value.

## Where to read it

| You want | Open | Entry |
| --- | --- | --- |
| The fix and why it was needed | [0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16) · [site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | First bullet under the first **Bug fixes** heading: "`stack apply` stops attempting to write placeholder secrets." |
| The current behavior | [Unreleased](../CHANGELOG.md#unreleased) · [site copy](../packages/site/src/data/CHANGELOG.md#unreleased) | **Changed**: "`stack apply` does not create placeholder secrets." |
| Vault output and unreadable-vault handling | [0.3.0 (2026-10-31)](../CHANGELOG.md#030-2026-10-31) · [site copy](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) | **Changed and fixed**, plus the detailed **Changed** entry |
| The original command description | [0.1.0 — 2026-04-19](../CHANGELOG.md#010--2026-04-19-superseded-by-011) · [site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) | **AI recommendation layer**, annotated with the history |

The 0.2.1 fix is the first bullet under the first **Bug fixes** heading. The release has a second **Bug fixes** heading under "Earlier 0.2.1 notes (2026-10-12)", so link to the release anchor, not the subsection name. Related but different `stack apply` fixes (a missing recipe writes nothing; a failed provider no longer stops later ones) are under [0.2.2](../CHANGELOG.md#022-2026-10-25) ([site copy](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)). For other `stack apply` changes, see [changelog source locations](changelog-source-locations.md).

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

## Reading the report

The 0.2.1 entry records what wiring used to do. For each declared secret it tried `phantom add <KEY> TODO_STACK_APPLY --rotate`, then tried again without `--rotate`. Phantom rejected values in arguments and did not support `--rotate`, so every call failed and the reported `envelopes` count was always zero. Code that reads the wiring result should use `present` and `missing` in place of `envelopes`.

An apply can finish without all required secrets: missing names alone do not fail it, though provider failures do. Review both the provider outcome and the wiring report before depending on the resulting setup.

With a readable vault, the changelog gives this example for a missing `OPENAI_API_KEY` and no webhooks:

```text
  secrets in vault 0 · missing 1 · webhooks 0
  (not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)
```

Supply each required missing value through Phantom: for this example, run `phantom add OPENAI_API_KEY` in a trusted terminal and enter the real value there. Do not put a secret value in command arguments.

If the vault is unreadable, the same recipe instead reports:

```text
  secrets in vault 0 · missing 0 · webhooks 0 · skipped 1
  (phantom-wire skipped: openai)
```

The zero counts cover only checked names; they do not prove that no secrets are missing. Resolve the skipped check before relying on the inventory. Unknown providers can also be skipped. Wiring can create webhook stubs for recipe providers even if they failed or the vault is unreadable; `--noWire` skips both the name checks and the stubs. See [apply troubleshooting](apply-troubleshooting.md) for help investigating skipped checks.

## Limits worth knowing

- Per the Unreleased entry, a missing name does not itself fail apply, while provider failures do, and `--noWire` skips both checks and stubs.
- Wiring can create webhook stubs even if the vault is unreadable; per the 0.2.1 entry, an unreadable vault reports providers as skipped instead of identifying missing names, which is not proof that no names are missing.
- 0.2.1 was tagged but its npm publish failed; [0.2.2](../CHANGELOG.md#022-2026-10-25) supersedes it. Check the installed version before applying this history.

## Upgrading from the old wiring

This section is for readers upgrading from the previous `stack apply` wiring: anyone whose last apply run predates the placeholder removal, or whose notes, runbooks and automation were written against the original 0.1.0 description. The entries describe source releases, not the version installed on a given machine; check `stack --version` and `stack apply --help` for what you actually run.

### What the earlier behavior was

The [0.1.0 entry](../CHANGELOG.md#010--2026-04-19-superseded-by-011) describes wiring that attempted to write a `TODO_STACK_APPLY` placeholder for each declared secret. The [0.2.1 fix entry](../CHANGELOG.md#021-2026-10-16) records the actual commands: wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without `--rotate`. Both forms failed every time, because Phantom Secrets refuses values in command arguments and has no `--rotate` flag. The printed `envelopes` count was always 0 and no placeholder was ever stored. The 0.1.0 wording is annotated with this later knowledge, and the commands it describes are historical, not instructions to run.

### What the changelog documents now

The [0.2.1 fix](../CHANGELOG.md#021-2026-10-16) is **`stack apply` stops attempting to write placeholder secrets.** Wiring checks declared secret names with `phantom list --json`; it never writes to the vault or fills missing values. `WireResult.envelopes` is replaced by `present` and `missing`. With a readable vault it prints `secrets in vault N · missing M · webhooks K` plus a `not in Phantom:` line; with an unreadable vault it reports providers as `skipped` instead of identifying missing names. Each required missing value needs user action: run `phantom add <NAME>` in a trusted terminal and enter the real value, never in a command argument.

Later entries complete the picture:

- [0.2.2 (2026-10-25)](../CHANGELOG.md#022-2026-10-25) records that 0.2.1 was tagged but its npm publish failed; 0.2.2 supersedes it, so the change first reached users in 0.2.2. The same release makes apply try every provider after a failure and resolve missing recipes before initialization.
- [0.3.0 (2026-10-31)](../CHANGELOG.md#030-2026-10-31) gives the readable- and unreadable-vault report examples and states that missing names alone do not make apply fail, so an applied recipe is not proof that every required secret is present.
- [Unreleased](../CHANGELOG.md#unreleased) extends the wiring scope: after at least one provider succeeds it checks secret names for every provider in the recipe, including providers that failed, and can create webhook stubs even when the vault is unreadable. `--noWire` skips both checks and stubs.

### Re-reading results from before the change

- An `envelopes` count in saved output (always 0) counted failed placeholder-write attempts, not stored secrets. Current results use `present`, `missing` and `skipped` instead.
- A successful apply never established that required secrets existed. The current entries make that explicit: missing names alone do not fail apply, while provider failures do.
- Because every placeholder write failed, apply left no `TODO_STACK_APPLY` value behind in the vault; there is nothing from those attempts to clean up.

### Why the old wording stays in the changelogs

That behavior is historical: the writes always failed, they were removed, and they do not happen today. Two entries still record it. The [0.2.1 fix entry](../CHANGELOG.md#021-2026-10-16) records the removal, and the [0.1.0 `stack apply [recipe-id]` entry](../CHANGELOG.md#010--2026-04-19-superseded-by-011) is the original feature description, annotated that placeholder writes were attempted and every call failed. Released sections are not rewritten (see [AGENTS.md](../AGENTS.md#changelog)), so both keep the old wording. The commands they quote are recorded to document the change; do not run them, and do not add placeholder values yourself: a placeholder is not a credential and can block a real value under the same name.

For an operator checklist against a real environment, see the [upgrade check](apply-upgrade-check.md); for the report examples, see [Reading the report](#reading-the-report).

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

## Term citations by entry

This index lists the terms all seven `stack apply` entries use, and for each term, the entries that use it. Every location exists in both changelog copies. The entries record source behavior at their release; check `stack apply --help` for the version you run.

### Entry labels

Each apply entry has a label that the terms table cites. Links open the release section; the entry text identifies the bullet inside it, because `Changed`, `Changed and fixed` and `Bug fixes` each occur more than once in the file.

| Label | Release → subsection | Entry begins | Root copy | Site copy |
| --- | --- | --- | --- | --- |
| U | Unreleased → Changed | `stack apply` does not create placeholder secrets. | [section](../CHANGELOG.md#unreleased) | [section](../packages/site/src/data/CHANGELOG.md#unreleased) |
| 0.3.0-CF | 0.3.0 (2026-10-31) → Changed and fixed | Apply wiring checks existing secret names without storing placeholders | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.3.0-C | 0.3.0 (2026-10-31) → Changed | After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.2.2-A | 0.2.2 (2026-10-25) → Bug fixes | **`stack apply` with a missing recipe writes nothing.** | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.2-B | 0.2.2 (2026-10-25) → Bug fixes | **`stack apply` and `stack init --template` keep going after a provider fails.** | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.1 | 0.2.1 (2026-10-16) → Bug fixes | **`stack apply` stops attempting to write placeholder secrets.** | [section](../CHANGELOG.md#021-2026-10-16) | [section](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) |
| 0.1.0 | 0.1.0 — 2026-04-19 (superseded by 0.1.1) → AI recommendation layer | **`stack apply [recipe-id]`** | [section](../CHANGELOG.md#010--2026-04-19-superseded-by-011) | [section](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) |

### Terms and the entries that cite them

| Term | Meaning in these entries | Cited in |
| --- | --- | --- |
| Recipe / recipe-id | A saved selection of providers that `stack apply` runs, typically written by `stack recommend --save`. An id that does not exist fails before anything is written; the error lists the saved ids or names the save command. | U, 0.3.0-C, 0.2.2-A, 0.2.2-B, 0.1.0 |
| Provider setup | The per-provider `stack add` run, which may itself store real credentials. It is distinct from the wiring step that follows. | 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| `stack add` pipeline | The existing provisioning pipeline apply re-runs for every provider in the recipe. Its failure no longer stops later providers. | 0.2.2-B, 0.1.0 |
| Wiring | The step after provider setup that checks the recipe's declared secret names against Phantom and can create webhook stubs. It runs only after at least one provider succeeds and covers every recipe provider, failed ones included. | U, 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| Declared secret name | An identifier such as `OPENAI_API_KEY` that a provider declares. Wiring compares names with the vault inventory; a present name does not validate its value. | U, 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| Real value / real credentials | The secret material a name points at. Wiring never writes it; provider setup or the user supplies it. | U, 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| Placeholder / placeholder secret | A dummy value written to stand in for a missing secret. The entries document that wiring no longer stores one; the term mainly records removed behavior. | U, 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| `TODO_STACK_APPLY` | The literal placeholder string old wiring passed to `phantom add`, first with `--rotate` and then without. Phantom refuses values in argv and has no `--rotate`, so every attempt failed. | 0.2.1, 0.1.0 |
| `envelopes` / `WireResult.envelopes` | The old wiring result count of placeholder writes, always 0 because the calls failed. Replaced by the `present` and `missing` arrays. | 0.2.1 |
| `present` / `missing` | The result classifications for declared names when the vault is readable. Missing names still need user action but do not fail apply. | U, 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| `skipped` | Providers whose names were not classified — the vault was unreadable or the provider is unknown. Skipped is not missing and not present. | 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| Webhook stub / `webhooks` | Generated example webhook handlers; the entries name Stripe, Clerk, Supabase and GitHub, and `webhooks` is the summary count. Stubs can be created even when the vault is unreadable. | U, 0.3.0-C, 0.2.1, 0.1.0 |
| `secrets in vault` / `not in Phantom:` | The wiring report lines. `secrets in vault N · missing M · webhooks K` counts present names only (it is not the vault's total), and `not in Phantom:` lists the missing names. | 0.3.0-C, 0.2.1 |
| `phantom add <NAME>` / trusted terminal | The user action for a required missing name: run the command in a trusted terminal and enter the real value at the prompt; secret values do not go on the command line. | 0.3.0-C, 0.2.1, 0.1.0 |
| `phantom list --json` | The command wiring uses to read the vault's names when it is readable. | 0.2.1 |
| `--noWire` | The opt-out flag. It skips both the secret-name check and webhook stubs and prints no wiring summary. | U, 0.3.0-C, 0.1.0 |
| Readable / unreadable vault | Whether wiring can enumerate Phantom's names. An unreadable vault yields skipped providers, and its zero counts cover only checked names — they do not prove names are absent. | U, 0.3.0-CF, 0.3.0-C, 0.2.1, 0.1.0 |
| Provider failure | A provider whose `stack add` run failed. Later providers still run; provider failures fail apply while missing names alone do not. | U, 0.2.2-B, 0.1.0 |
| `Some providers failed` / exit 1 | The summary line and exit code that end a run in which providers failed. | 0.2.2-B |
| Partial-failure rollback | The cleanup offered when some providers fail and others succeeded: the run's successful adds are removed again — their `.stack.toml` entries, local secrets and MCP entries — so a re-run is not blocked. The early exit the entry describes skipped it along with the later providers and the summary. | 0.2.2-B |
| Missing recipe / auto-`stack init` | An apply for an id that does not exist in a directory without `.stack.toml`. It once ran `stack init` and left files behind; the recipe is now resolved first so nothing is written. | 0.2.2-A |
| `@clack/prompts` picker | The interactive recipe chooser shown when `stack apply` is given no id. | 0.1.0 |

### Scope notes

- Citations describe the checked-in files, not a deployed site or an installed version. If the copies ever diverge, the site build's `sync-content` overwrite resolves toward the root file, so review differences before syncing.
- Strings that spell `stack apply` outside these entries are mentions, not apply entries: the `stack_apply` MCP tool (0.2.2 → MCP project targeting), a piped `stack apply` example and `stack templates apply` (0.2.2 → Agent-facing output), the hero animation (0.2.1 → Hero "Generate a stack" demo), and the `stack recommend` follow-up line (0.1.0). `--apply` flags on `stack doctor --ecosystem` (0.2.2) and `stack upgrade` (0.3.0) are options on other commands with their own meanings. Rollback named outside 0.2.2-B — `stack add` and `stack remove` (0.2.2 → Vendor-neutral MCP wiring), `stack add` failure (0.2.0 → Added) and `stack upgrade --apply` (0.3.0 → Added) — belongs to those commands, not to apply's partial-failure pass.
- Within the apply entries, "missing" also describes an absent recipe (0.2.2-A) and an absent secret name (the wiring classification); an "applied" recipe is a run outcome, not proof that required secrets exist.

For the entry-by-entry file mapping behind these labels, see the [site changelog source map](site-changelog-review.md#apply-entry-source-map). For the wiring senses with output examples, see [apply terminology with examples](apply-terminology-examples.md) and [apply wiring terminology](apply-wiring-terminology.md).

## Do the two changelogs differ?

Not in this checkout: the files are byte-for-byte identical, so each entry has the same location, wording, punctuation and issue reference in both. They differ in role, not content:

- `CHANGELOG.md` is the repository changelog and the source of truth for release notes.
- `packages/site/src/data/CHANGELOG.md` is the copy the site renders at `/docs/changelog`. The site's `sync-content` script overwrites it with the root file before site development and builds, so a site-only edit would be overwritten by the next sync.

Verify rather than assume, because a difference can appear between syncs. From the repository root:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean they match. Status 1 prints the differences (`-` lines are from the root changelog, `+` lines from the site copy); a higher status is an error such as a missing file, not a successful comparison.

## Entry-by-entry comparison

The corresponding entries below have **no wording differences** between the
[root changelog](../CHANGELOG.md) and the
[site changelog data](../packages/site/src/data/CHANGELOG.md): their text,
punctuation and Markdown match. This is a source comparison, not evidence of
what is installed or published.

| Location in both files | Corresponding entry and emphasis |
| --- | --- |
| [Unreleased → Changed](../CHANGELOG.md#unreleased) ([site](../packages/site/src/data/CHANGELOG.md#unreleased)) | `stack apply` does not create placeholder secrets. After a provider succeeds, wiring checks all recipe providers, including failures; missing names alone do not fail apply. Webhook stubs can be created even if the vault is unreadable; `--noWire` skips both operations. |
| [0.3.0 → Changed and fixed](../CHANGELOG.md#030-2026-10-31) ([site](../packages/site/src/data/CHANGELOG.md#030-2026-10-31)) | The short apply-wiring summary distinguishes skipped unreadable vaults from missing names and notes that provider setup may store real credentials. |
| [0.3.0 → Changed](../CHANGELOG.md#030-2026-10-31) ([site](../packages/site/src/data/CHANGELOG.md#030-2026-10-31)) | The longer apply note explains required values, readable and unreadable vault output, skipped unknown providers, and `--noWire`. Its examples caution that zero checked counts do not prove the vault is empty. |
| [0.2.2 → Agent-facing output](../CHANGELOG.md#022-2026-10-25) ([site](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)) | The Bun pipe-output fix includes the final line of a failing `stack apply` as an example. |
| [0.2.2 → Bug fixes](../CHANGELOG.md#022-2026-10-25) ([site](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)) | Two entries cover resolving a missing recipe before initialization and continuing through provider failures with a failure summary and exit 1. |
| [0.2.1 → Bug fixes](../CHANGELOG.md#021-2026-10-16) ([site](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)) | The placeholder fix says wiring does not write to the vault, describes the failed earlier attempts, and replaces `WireResult.envelopes` with `present` and `missing`. Provider setup may separately store real values. |
| [0.2.1 → Hero “Generate a stack” demo](../CHANGELOG.md#021-2026-10-16) ([site](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)) | The site demo depicts a recommend-to-apply loop. |
| [0.1.0 → AI recommendation layer](../CHANGELOG.md#010--2026-04-19-superseded-by-011) ([site](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011)) | The recommend, apply and MCP bullets describe saved recipes, apply wiring and `stack_apply`. The apply bullet incorporates the later placeholder fix; it is not a verbatim record of the original release behavior. |

The entries within each file describe different releases and aspects of apply;
differences in their emphasis are not differences between the two copies.
Other commands' `--apply` flags are outside this comparison.

## Placeholder-wiring language

**There are no wording or substantive differences between the two copies** of
the `stack apply` placeholder-wiring change. The sections that describe it
differ only in scope:

| Location in each file | Wording and scope |
| --- | --- |
| Unreleased → Changed | Says apply creates no placeholder secrets; after at least one provider succeeds, wiring checks all recipe providers, including failed ones. Missing names alone do not fail apply; provider failures do. Webhook stubs can be created even with an unreadable vault, and `--noWire` skips checks and stubs. |
| 0.3.0 → Changed and fixed | Summarizes the name check, skipped unreadable vaults, and the separate possibility of provider setup storing real credentials. |
| 0.3.0 → Changed | Explains missing-name reporting, the trusted-terminal `phantom add <NAME>` action, unreadable vault and unknown-provider skips, example output, and why zero checked counts do not prove the vault is empty. |
| 0.2.1 → Bug fixes | Describes the fix: wiring no longer writes to the vault or fills missing values. The former placeholder-add attempts failed, and `WireResult.envelopes` was replaced by `present` and `missing`. |
| 0.1.0 → AI recommendation layer | Describes apply and webhook wiring, with the later placeholder fix incorporated and missing names distinguished from provider failures. |

Wiring's name checks do not prevent provider setup from separately storing real
credentials. Missing required values still need user action through Phantom.

## The 0.2.1 fix entry

In each file, the fix is the first bullet under **Bug fixes** in 0.2.1
(2026-10-16), beginning “`stack apply` stops attempting to write placeholder
secrets.” The 0.2.1 links in the [entry-by-entry table](#entry-by-entry-comparison) point to that release heading.

**Substantive wording differences: none.** The complete entry is identical in
both checked-in sources, including its commands, result fields and historical
explanation. Both distinguish wiring's name checks from provider setup, which may
store real values; describe supplying required missing values through Phantom;
and say an unreadable vault results in providers being reported as skipped.
Both also describe the failed placeholder-add attempts and the replacement of
`WireResult.envelopes` with `present` and `missing`.

| Topic | What both entries say |
| --- | --- |
| Wiring and setup | Wiring does not write to the vault or fill missing values; provider setup may separately store real values. |
| Required values | Users supply each required missing value through Phantom in a trusted terminal. |
| Readable vault | Wiring checks names with `phantom list --json`, reports present and missing counts and lists missing names. |
| Unreadable vault | Providers are reported as skipped, rather than identified as missing. |
| Previous behavior | Placeholder-add attempts failed; the printed `envelopes` count was always zero. |
| Result fields | `WireResult.envelopes` was replaced by `present` and `missing`. |

The [mirroring guide](changelog-mirroring.md#the-021-apply-fix) describes how to
locate this entry and compare the files.

## Maintaining these notes

For maintainers editing the release notes. The root changelog is the source; review both copies before running the site `dev`, `start`, `build`, or `sync-content` scripts, because they copy the root changelog over the site copy.

From the repository root:

1. Compare the copies with `diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md`.
   Exit 0 means they match; exit 1 shows differences; a higher status means an
   error. Investigate site-only changes before overwriting them.
2. Search both files for `stack apply`, `Apply wiring`, `TODO_STACK_APPLY`, and
   `phantom-wire`; read each match in its release section, including examples.
   In particular, compare 0.1.0's original description, the 0.2.1 placeholder
   fix, 0.2.2's provider-failure and missing-recipe fixes, 0.3.0's wiring
   examples, and Unreleased's partial-failure detail. Check equivalent claims
   and qualifications across releases as well as between copies. Historical
   attempts to write placeholders failed; the 0.2.1 fix removed the attempts.
   Preserve that chronology rather than treating old behavior as current.
3. Resolve discrepancies against the relevant implementation, tests, and change
   history. Equal copies alone do not prove correctness. Make intended corrections
   in the root file, preserve historical context, and sync the site copy with
   `bun run --cwd packages/site sync-content`. Repeat the diff and inspect
   `git diff -- CHANGELOG.md packages/site/src/data/CHANGELOG.md`; the sync
   overwrites the whole copy and suppresses copy errors.
4. Run `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts scripts/apply-changelog.test.ts`
   to check the copies and documented behavior. These checks cover the checkout,
   not a deployed site or an installed release.

### Review checklist for the 0.2.1 entry

Use this checklist in step 2 for the **`stack apply` stops attempting to write placeholder secrets.**
entry under **0.2.1 (2026-10-16) → Bug fixes** in both the
[root changelog](../CHANGELOG.md#021-2026-10-16) and the
[site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16).
These are corresponding entries in checked-in files; this review does not
verify a deployed site or an installed release.

- [ ] **Locate both entries.** Confirm each file has one matching bullet in the
  stated release and subsection. Read the complete bullet, including historical
  details, and compare what each says `stack apply` does. Investigate any missing,
  duplicate, or conflicting claim before copying either file.
- [ ] **Compare secret handling.** Do both distinguish wiring, which does not
  write to the vault or fill missing values, from provider setup, which may
  store real values? Do both say users supply required missing values through
  Phantom in a trusted terminal?
- [ ] **Compare the two vault outcomes.** For a readable vault, check the name
  inventory, present/missing counts and list of missing names. For an unreadable
  vault, check that providers are reported as skipped, not as missing. Check the
  historical failed placeholder attempts and the replacement of
  `WireResult.envelopes` with `present` and `missing`.
- [ ] **Check current context.** Read **Unreleased → Changed** and **0.3.0 →
  Changed** in both files as well. Compare the conditions for wiring, its scope
  across recipe providers including failures, the effects of missing names and
  provider failures, webhook stubs, and `--noWire`. Check that the historical
  fix and later notes do not give readers a misleading picture together.
- [ ] **Resolve and verify differences.** Check disputed behavior against the
  implementation or tests; matching text alone does not prove it is correct.
  The root changelog is the source for the site copy. Review differences before
  running site build, dev, or `sync-content`, which overwrite the site copy.
  Follow the [mirroring guide](changelog-mirroring.md#maintainer-rule) to reconcile,
  sync and test any changes, and inspect the resulting diff.

Review each relevant entry in context whether or not the whole-file diff in
step 1 shows a match.

## Verify

```bash
grep -n -F 'stops attempting to write placeholder secrets.' \
  CHANGELOG.md packages/site/src/data/CHANGELOG.md
grep -n -F 'TODO_STACK_APPLY' CHANGELOG.md packages/site/src/data/CHANGELOG.md
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts scripts/apply-changelog-reader-guide.test.ts
```

Expect exactly one hit per file for the first `grep`, inside 0.2.1 → Bug fixes, and two per file for the second, one in the 0.2.1 fix entry and one in the 0.1.0 entry; no `diff` output; and the tests to pass, including the site test's byte-equality check.

For deeper reading see the [mirroring guide](changelog-mirroring.md#review-before-syncing) for comparing the two files, and the [apply history guide](apply-history-reader-guide.md).
