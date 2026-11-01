# `stack apply` placeholder change timeline

The [changelog](../CHANGELOG.md) records when apply wiring stopped attempting
to add placeholder secrets. The entries below describe the source history;
check your installed version and its `stack apply --help` before relying on
release-specific behavior.

| Changelog entry | Recorded change |
| --- | --- |
| [0.1.0 — 2026-04-19](../CHANGELOG.md#010--2026-04-19-superseded-by-011) | The apply entry describes the original recipe workflow. Its historical annotation says wiring attempted a `TODO_STACK_APPLY` value for each declared secret and that the attempts failed. |
| [0.2.1 — 2026-10-16](../CHANGELOG.md#021-2026-10-16), Bug fixes | **`stack apply` stops attempting to write placeholder secrets.** The fix removed those attempts and replaced `WireResult.envelopes` with `present` and `missing`. |
| [0.2.2 — 2026-10-25](../CHANGELOG.md#022-2026-10-25) | 0.2.1 was tagged but its npm publish failed; 0.2.2 superseded it and shipped the changes listed under 0.2.1. |
| [0.3.0 — 2026-10-31](../CHANGELOG.md#030-2026-10-31) | The changelog describes name checks, missing and skipped results, and example output. |
| [Unreleased](../CHANGELOG.md#unreleased) | The entry clarifies that wiring covers the entire recipe after at least one provider succeeds, including failed providers, and may create webhook stubs even if the vault is unreadable. |

## Before and after

Previously, wiring attempted `phantom add <KEY> TODO_STACK_APPLY --rotate`,
then tried without `--rotate`, for every declared secret. Phantom rejects
values in command arguments and does not support that option; the changelog
records that every call failed and the printed `envelopes` count was always
zero. The attempts did not create usable credentials.

Currently, wiring checks declared names using `phantom list --json`; it does
not write to the vault or fill in missing values. Provider setup is separate
and may store real credentials. A readable vault yields present and missing
names; an unreadable vault yields skipped providers, not a conclusion that
names are missing. Presence checks do not verify credential values.

A missing name alone does not fail apply, while provider failures do. For each
required missing name, run `phantom add <NAME>` in a trusted terminal, replacing
`<NAME>` with the name and entering the real value when prompted. Wiring can
also create webhook stubs for recipe providers even if their setup failed or
the vault is unreadable. `--noWire` skips both name checks and stubs. If no
provider succeeds, apply does not attempt wiring.

See [the migration checklist](apply-placeholder-migration.md) for interpreting
an existing apply result and [the changelog timeline](changelog-placeholder-timeline.md)
for the site mirror and exact entry.
