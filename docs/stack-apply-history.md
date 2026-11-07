# `stack apply` placeholder history

The [changelog](../CHANGELOG.md) records one change to the Phantom wiring
step of `stack apply`: it used to attempt writing a placeholder for each
declared secret; it now only checks names. This page summarizes the recorded
entries. The commands quoted below are historical — **do not run them**.

## Former behavior: attempted placeholders

When `stack apply` was introduced in
[0.1.0](../CHANGELOG.md#010--2026-04-19-superseded-by-011) (the entry is
annotated with later notes), wiring attempted to run
`phantom add <KEY> TODO_STACK_APPLY --rotate` — then retried without
`--rotate` — for every secret name a recipe declared.

Every attempt failed. Phantom Secrets refuses secret values in command
arguments and has no `--rotate` flag, so nothing was ever written and the
reported `envelopes` count was always zero. `TODO_STACK_APPLY` is a marker
string, not a credential: no placeholder was ever stored, and storing one
yourself under a real name can block the real value from being saved.

## Recorded change

The [0.2.1 entry](../CHANGELOG.md#021-2026-10-16) records the fix: wiring
stopped attempting the writes, and `WireResult.envelopes` was replaced by
`present` and `missing`. The [0.2.2 entry](../CHANGELOG.md#022-2026-10-25)
notes that 0.2.1 was tagged but its npm publish failed, so 0.2.2 shipped the
fix.

Later entries refine the same behavior:

- [0.3.0](../CHANGELOG.md#030-2026-10-31): wiring checks existing secret
  names without storing placeholders; an unreadable vault is reported as
  skipped, not missing. Provider setup may still persist real credentials
  through its own workflow.
- [Unreleased](../CHANGELOG.md#unreleased): after at least one provider
  succeeds, wiring checks every provider in the recipe, including providers
  that failed. A missing name alone does not fail apply; provider failures
  do. Wiring may also create webhook stubs for recipe providers even when
  the vault is unreadable. `--noWire` skips both the name checks and the
  stubs.

## What to do today

Wiring never writes to the vault and never fills missing values. If apply
reports a missing secret name, obtain the real value from the provider and
run `phantom add <NAME>` in a trusted terminal, entering the value when
prompted; do not pass values in command arguments.

Release notes describe source history — run `stack --version` and check the
installed version's documentation before relying on a recorded behavior. For
more detail see the [placeholder history](apply-placeholder-history.md) and
[apply troubleshooting](apply-troubleshooting.md).
