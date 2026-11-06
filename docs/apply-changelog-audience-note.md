# Audience note: the `stack apply` wiring change for upgraders

This note is for readers upgrading from the previous `stack apply` wiring —
anyone whose last apply run predates the placeholder removal, or whose notes,
runbooks and automation were written against the original 0.1.0 description.
It explains what the [repository changelog](../CHANGELOG.md) (mirrored in the
[site changelog data](../packages/site/src/data/CHANGELOG.md)) records as
changed and what that means for expectations set by the earlier behavior.
The entries describe source releases, not the version installed on a given
machine; check `stack --version` and `stack apply --help` for what you
actually run.

## What the earlier behavior was

The [0.1.0 entry](../CHANGELOG.md#010--2026-04-19-superseded-by-011) describes
wiring that attempted to write a `TODO_STACK_APPLY` placeholder for each
declared secret. The [0.2.1 fix entry](../CHANGELOG.md#021-2026-10-16)
records the actual commands: wiring ran `phantom add <KEY> TODO_STACK_APPLY
--rotate`, then retried without `--rotate`. Both forms failed every time —
Phantom Secrets refuses values in command arguments and has no `--rotate`
flag — so the printed `envelopes` count was always 0 and no placeholder was
ever stored. The 0.1.0 wording is annotated with this later knowledge, and
the commands it describes are historical, not instructions to run.

## What the changelog documents now

The change is recorded in
[0.2.1 (2026-10-16) → Bug fixes](../CHANGELOG.md#021-2026-10-16): **`stack
apply` stops attempting to write placeholder secrets.** Wiring checks
declared secret names with `phantom list --json`; it never writes to the
vault or fills missing values. `WireResult.envelopes` is replaced by
`present` and `missing`, and an unreadable vault reports providers as
`skipped` instead of identifying missing names. Each required missing value
needs user action: run `phantom add <NAME>` in a trusted terminal and enter
the real value, never in a command argument.

Later entries complete the picture:

- [0.2.2 (2026-10-25)](../CHANGELOG.md#022-2026-10-25) records that 0.2.1 was
  tagged but its npm publish failed; 0.2.2 supersedes it, so the change first
  reached users in 0.2.2. The same release makes apply try every provider
  after a failure and resolve missing recipes before initialization.
- [0.3.0 (2026-10-31) → Changed](../CHANGELOG.md#030-2026-10-31) gives the
  readable- and unreadable-vault report examples and states that missing
  names alone do not make apply fail, so an applied recipe is not proof that
  every required secret is present.
- [Unreleased → Changed](../CHANGELOG.md#unreleased) extends the wiring
  scope: after at least one provider succeeds it checks secret names for
  every provider in the recipe, including providers that failed, and can
  create webhook stubs even when the vault is unreadable. `--noWire` skips
  both checks and stubs.

## Re-reading results from before the change

- An `envelopes` count in saved output — always 0 — counted failed
  placeholder-write attempts, not stored secrets. Current results use
  `present`, `missing` and `skipped` instead.
- A successful apply never established that required secrets existed; the
  current entries make that explicit — missing names alone do not fail
  apply, while provider failures do.
- Because every placeholder write failed, apply left no `TODO_STACK_APPLY`
  value behind in the vault; there is nothing from those attempts to clean
  up.

For an operator checklist against a real environment, see the
[upgrade check](apply-upgrade-check.md); for the report examples and their
interpretation, see the [reader guide](changelog-apply-reader-guide.md).
