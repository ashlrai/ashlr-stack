# Changelog glossary: the `stack apply` placeholder

Short answers for readers of the `stack apply` changelog entries. For the full
tour, see the [reader guide](apply-changelog-reader-guide.md). Entries live in
[CHANGELOG.md](../CHANGELOG.md) and its identical site copy,
[packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md).
This page describes those files, not an installed version.

## The placeholder

The placeholder is `TODO_STACK_APPLY`. It is a dummy value, not a secret name
and not a usable credential.

Older wiring tried to add it to Phantom for every secret a recipe declared. It
ran `phantom add <KEY> TODO_STACK_APPLY --rotate`, then the same call without
`--rotate`. Phantom refuses values passed on the command line, so every attempt
failed and nothing was stored. The 0.2.1 changelog entry records the fix.

Current `stack apply` never writes placeholders. It only checks which secret
names exist.

## Other words in the entries

| Word | Plain meaning |
| --- | --- |
| Wiring | The step after providers are set up. It checks secret names in Phantom and may write webhook stubs. |
| `envelopes` | The old count of placeholder writes. It was always 0. Replaced by `present` and `missing`. |
| `present` / `missing` | Secret names found or not found in a readable vault. A name that is present is not proof its value is valid. |
| `skipped` | Providers that could not be checked, such as when the vault is unreadable. Not the same as missing. |
| `--noWire` | Skips the name check and webhook stubs. |

## What to do

If a required secret is missing, run `phantom add <NAME>` in a trusted
terminal and type the real value. Nothing else is needed.

## Agent path

Read the same facts as data, with no screen to scrape:

- `stack apply --help` lists the options for your version.
- `stack apply` reports `present`, `missing` and `skipped` through the typed
  `WireResult`.
- `bun test scripts/apply-changelog-reader-glossary.test.ts` checks this page
  against both changelogs.
