# Historical `stack apply` placeholder command

This page records the Phantom command that `stack apply` wiring once attempted
for every declared secret, and where the [changelog](../CHANGELOG.md) documents
its removal. It is a historical record only: nothing here is a current
instruction. Do not run the command shown below — it failed when apply
attempted it, and it still fails today.

## The attempted command

Before the removal, wiring attempted a placeholder add for each declared
secret, first with an unsupported option and then again without it:

- The first attempt, `phantom add <KEY> TODO_STACK_APPLY --rotate`, failed
  because Phantom Secrets has no `--rotate` option.
- The retry, `phantom add <KEY> TODO_STACK_APPLY` without `--rotate`, failed
  because Phantom Secrets refuses secret values in command arguments, which
  are visible to other processes.

Both historical attempts failed for every declared secret, so they stored no
placeholder and the old `envelopes` count was always 0. They did not create
usable credentials. Do not run either form: the marker value is not a
credential, and current Phantom still rejects a value passed as an argument.

## Where the changelog documents the removal

The removal is recorded as the first bullet of `### Bug fixes` under
[0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16), titled **`stack apply`
stops attempting to write placeholder secrets.** in both the
[root changelog](../CHANGELOG.md) and the
[site mirror](../packages/site/src/data/CHANGELOG.md). Its historical summary
is the verbatim source of those attempts:

> Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate` (then
> without `--rotate`) for every declared secret. Phantom Secrets refuses
> values in argv and has no `--rotate`, so every call failed and the printed
> `envelopes` count was always 0. `WireResult.envelopes` is replaced by
> `present` and `missing`.

The oldest apply entry is annotated the same way. Under
[0.1.0 — 2026-04-19 (superseded by 0.1.1)](../CHANGELOG.md#010--2026-04-19-superseded-by-011),
the `stack apply` bullet notes:

> Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder
> for each declared secret, but those calls failed; the 0.2.1 fix above
> removed the attempts.

0.2.1 was tagged but never published to npm; its changes first reached users
in [0.2.2 (2026-10-25)](../CHANGELOG.md#022-2026-10-25), which states that it
ships everything under 0.2.1. Later entries —
[0.3.0 (2026-10-31)](../CHANGELOG.md#030-2026-10-31) and
[Unreleased](../CHANGELOG.md#unreleased) — describe only the current
name-checking behavior; no changelog entry instructs anyone to run the
historical placeholder command.

## What runs instead

Current wiring compares declared secret names with `phantom list --json`
output and reports `present`, `missing`, and `skipped`; it does not write to
the vault or fill missing values. To store a required secret, run
`phantom add <NAME>` in a trusted terminal and enter the real value when
prompted — never as a command argument. `--noWire` skips the inventory check
and webhook stubs. A missing name alone does not fail apply; provider
failures do.

For the entry-by-entry release map see the
[changelog placeholder timeline](changelog-placeholder-timeline.md); for
definitions see [placeholder terminology](apply-placeholder-terminology.md);
for the full behavior description see
[`stack apply` and placeholder secrets](apply-placeholder-history.md). Check
the changelog and `stack apply --help` for the version you actually use — a
source changelog does not establish what is installed.
