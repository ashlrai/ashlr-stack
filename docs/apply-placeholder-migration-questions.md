# Migration questions: the former `stack apply` placeholder behavior

These are reader questions about the placeholder writes `stack apply` wiring
once attempted. Each answer is limited to what the
[changelog](../CHANGELOG.md) records; the changelog describes the code across
releases, not the state of an individual vault or project. Check the installed
version and `stack apply --help`: a source changelog is not proof of what is
installed, and 0.2.1 was tagged without reaching npm.

## What did the former wiring attempt?

For every declared secret, wiring ran
`phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without
`--rotate`. The [0.2.1 entry](../CHANGELOG.md#021-2026-10-16) records this as
the behavior its fix removed, and the
[0.1.0 apply entry](../CHANGELOG.md#010--2026-04-19-superseded-by-011) is
annotated with the same history.

## Did the attempts ever write a placeholder to the vault?

No. Phantom Secrets refuses secret values in command arguments and has no
`--rotate` option, so every call failed and the printed `envelopes` count was
always 0. The changelog records failed attempts, not stored placeholders;
they did not create usable credentials.

## Did the attempts rotate or overwrite stored secrets?

No. There was no `--rotate` option to invoke, every call failed regardless of
which form ran, and the changelog also records that Phantom never replaces a
stored name. The attempted option rotated nothing.

## What did the `envelopes` count report?

Always 0, because every placeholder call failed. The fix replaced
`WireResult.envelopes` with `present` and `missing`, which report checked
secret names rather than attempted writes.

## Which release removed the attempts?

The removal is recorded under [0.2.1](../CHANGELOG.md#021-2026-10-16), but
0.2.1's npm publish failed, so nothing from it reached npm.
[0.2.2](../CHANGELOG.md#022-2026-10-25) superseded it and ships everything
listed under 0.2.1. The later entries —
[0.3.0](../CHANGELOG.md#030-2026-10-31) and
[Unreleased](../CHANGELOG.md#unreleased) — describe only the name-checking
wiring.

## Did provider setup write placeholders too?

The changelog does not say that. It notes provider setup may store real values
through its own workflow, separately from wiring. The placeholder attempts
belonged to the wiring step, which now never writes to the vault or fills
missing values.

## Must I delete placeholder values apply left behind?

The changelog prescribes no cleanup of existing secrets. Every recorded call
failed, so it describes no apply-written placeholders to remove. What it
prescribes runs the other direction: supply each required *missing* value
yourself — run `phantom add <NAME>` in a trusted terminal and enter the real
value when prompted, never as a command argument.

## What does wiring do instead?

After at least one provider succeeds, wiring checks the recipe's declared
secret names against `phantom list --json` for every provider in the recipe,
including failed providers, and can create webhook stubs even when a provider
failed or the vault is unreadable. A readable vault reports present and
missing names; an unreadable one reports providers as skipped, not missing.
A missing name alone does not fail apply; provider failures do. `--noWire`
skips both the check and the stubs.

## What does the changelog not answer?

- Whether a `TODO_STACK_APPLY` value sits in a particular vault. Every
  recorded call failed, but the changelog does not establish an individual
  vault's contents.
- Whether a historical apply run failed when its placeholder calls failed.
  The changelog records that the calls failed and `envelopes` printed 0, not
  the exit status of those runs.
- Which behavior a given install exhibits. Compare the installed version's
  own changelog and `stack apply --help`; this repository's changelog does
  not establish what is installed.

For where each entry records the removal, see the
[placeholder command history](apply-placeholder-command-history.md) and the
[changelog placeholder timeline](changelog-placeholder-timeline.md). For
interpreting an apply result you already have, see the
[migration checklist](apply-placeholder-migration.md) and
[troubleshooting](apply-troubleshooting.md).
