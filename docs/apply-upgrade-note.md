# Upgrade note: `stack apply` and placeholder secrets

This note is for anyone upgrading across the `stack apply` wiring change —
scripts, runbooks or saved output written while the original
[0.1.0 entry](../CHANGELOG.md#010--2026-04-19-superseded-by-011) described the
behavior. It summarizes the former placeholder behavior and the current
behavior as recorded in [CHANGELOG.md](../CHANGELOG.md), mirrored in the
[site changelog data](../packages/site/src/data/CHANGELOG.md). The changelog
describes source history, not the version installed on a given machine; check
`stack --version` and `stack apply --help` for what you actually run.

## Former placeholder behavior

The original wiring attempted to store a placeholder for each declared
secret. The [0.2.1 fix entry](../CHANGELOG.md#021-2026-10-16) records the
actual commands: `phantom add <KEY> TODO_STACK_APPLY --rotate`, then a retry
without `--rotate`, for every declared secret. Phantom Secrets refuses
values in command arguments and has no `--rotate` option, so every call
failed, no placeholder was ever stored, and the reported `envelopes` count
was always 0. These commands are historical, not instructions to run.

Because every write failed, the attempts left no `TODO_STACK_APPLY` value in
the vault; there is nothing from them to clean up. An `envelopes` count in
saved output counted failed attempts, not stored secrets, and a successful
apply never established that required secrets existed.

## Current behavior

The [0.2.1 fix](../CHANGELOG.md#021-2026-10-16) removed the write attempts,
and later entries refine the details
([0.3.0](../CHANGELOG.md#030-2026-10-31),
[Unreleased](../CHANGELOG.md#unreleased)):

- Wiring never writes to the vault and does not fill missing values. When
  the vault is readable it checks declared secret names with
  `phantom list --json` and reports `secrets in vault`, `missing` and
  `webhooks` counts plus a `not in Phantom:` line. `WireResult.envelopes` is
  replaced by `present` and `missing`.
- After at least one provider succeeds, wiring covers every provider in the
  recipe, including providers that failed. A missing name does not itself
  fail apply; provider failures do — an applied recipe is not proof that
  every required secret is present.
- If the vault cannot be read, providers are reported as `skipped` instead
  of being identified as missing, and the counts cover only checked names.
  Unknown providers are skipped too.
- Wiring may create webhook stubs under `.stack/webhooks/` even for failed
  providers or an unreadable vault; the stubs need signature verification
  before use. `--noWire` skips both the secret-name check and the stubs.
- Each required missing value needs user action: run
  `phantom add <NAME>` in a trusted terminal and enter the real value there,
  never as a command argument. Provider setup may separately store real
  credentials through its own workflow.

## Availability

The [0.2.2 entry](../CHANGELOG.md#022-2026-10-25) records that 0.2.1 was
tagged but its npm publish failed, so nothing from 0.2.1 reached npm and
0.2.2 supersedes it — the change first shipped to npm users in 0.2.2. Do not
assume the behavior of an installed version from the changelog alone.

## Related reading

- [Upgrade check](apply-upgrade-check.md) — an operator checklist for
  finding dependencies on the old behavior.
- [Placeholder history](apply-placeholder-history.md) — the annotated
  timeline of the change.
- [Troubleshooting `stack apply`](apply-troubleshooting.md) — skipped
  checks, rollback and recovery.
