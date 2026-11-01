# `stack apply` changelog terminology

This glossary defines the terms the `stack apply` entries use and cites, for
each term, the entries that use it in both the [repository changelog](../CHANGELOG.md)
and the [site changelog data](../packages/site/src/data/CHANGELOG.md). The
site's `sync-content` script copies the root file over the site copy for site
development and builds, so the checked-in files are byte-for-byte identical and
every location below exists in each. The entries record source behavior at
their release; check the changelog and `stack apply --help` for the version you
run.

## Entry locations

Each apply entry has a label the glossary cites. Links open the release
section; the entry text identifies the bullet inside it, because `Changed`,
`Changed and fixed` and `Bug fixes` each occur more than once in the file.

| Label | Release → subsection | Entry begins | Root copy | Site copy |
| --- | --- | --- | --- | --- |
| U | Unreleased → Changed | `stack apply` does not create placeholder secrets. | [section](../CHANGELOG.md#unreleased) | [section](../packages/site/src/data/CHANGELOG.md#unreleased) |
| 0.3.0-CF | 0.3.0 (2026-10-31) → Changed and fixed | Apply wiring checks existing secret names without storing placeholders | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.3.0-C | 0.3.0 (2026-10-31) → Changed | After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.2.2-A | 0.2.2 (2026-10-25) → Bug fixes | **`stack apply` with a missing recipe writes nothing.** | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.2-B | 0.2.2 (2026-10-25) → Bug fixes | **`stack apply` and `stack init --template` keep going after a provider fails.** | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.1 | 0.2.1 (2026-10-16) → Bug fixes | **`stack apply` stops attempting to write placeholder secrets.** | [section](../CHANGELOG.md#021-2026-10-16) | [section](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) |
| 0.1.0 | 0.1.0 — 2026-04-19 (superseded by 0.1.1) → AI recommendation layer | **`stack apply [recipe-id]`** | [section](../CHANGELOG.md#010--2026-04-19-superseded-by-011) | [section](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) |

## Terms

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
| Missing recipe / auto-`stack init` | An apply for an id that does not exist in a directory without `.stack.toml`. It once ran `stack init` and left files behind; the recipe is now resolved first so nothing is written. | 0.2.2-A |
| `@clack/prompts` picker | The interactive recipe chooser shown when `stack apply` is given no id. | 0.1.0 |

## Scope notes

- Citations describe the checked-in files, not a deployed site or an installed
  version. Where the copies ever diverge, the site build's `sync-content`
  overwrite resolves toward the root file, so review differences before
  syncing.
- Strings that spell `stack apply` outside these entries are mentions, not
  apply entries: the `stack_apply` MCP tool (0.2.2 → MCP project targeting), a
  piped `stack apply` example and `stack templates apply` (0.2.2 → Agent-facing
  output), the hero animation (0.2.1 → Hero "Generate a stack" demo), and the
  `stack recommend` follow-up line (0.1.0). `--apply` flags on
  `stack doctor --ecosystem` (0.2.2) and `stack upgrade` (0.3.0) are options on
  other commands with their own meanings.
- Within the apply entries, "missing" also describes an absent recipe (0.2.2-A)
  and an absent secret name (the wiring classification); an "applied" recipe is
  a run outcome, not proof that required secrets exist.

For the entry-by-entry file mapping behind these labels, see the
[site changelog source map](site-changelog-source-map.md). For the wiring
senses with output examples, see
[apply terminology with examples](apply-terminology-examples.md) and
[apply wiring terminology](apply-wiring-terminology.md).
