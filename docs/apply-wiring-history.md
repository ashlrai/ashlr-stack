# `stack apply` wiring history

The [changelog](../CHANGELOG.md#021-2026-10-16) records a change to the
Phantom wiring step of `stack apply`. This page describes the historical
command to explain the change; **do not run it**.

## Previous behavior

For each declared secret, wiring attempted
`phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without
`--rotate`. Phantom Secrets does not support `--rotate` and rejects secret
values in command arguments. Both attempts failed, so the old `envelopes`
count was always zero. `TODO_STACK_APPLY` was a marker, not a usable
credential; do not store it as a secret.

## Documented change

The 0.2.1 changelog says wiring stopped attempting these writes and replaced
`WireResult.envelopes` with `present` and `missing`. Version 0.2.1 was tagged
but not published to npm; [0.2.2](../CHANGELOG.md#022-2026-10-25) includes
the fix. The [0.3.0](../CHANGELOG.md#030-2026-10-31) and
[Unreleased](../CHANGELOG.md#unreleased) entries describe the later behavior:

- After at least one provider succeeds, wiring checks secret names for every
  provider in the recipe, including failed providers. It does not write to the
  vault or fill missing values. Provider setup can separately store real
  credentials.
- A readable vault yields present and missing counts and missing names. A
  missing name alone does not fail apply; provider failures do. If the vault
  cannot be read, providers are reported as skipped, not missing. Counts do
  not validate secret values.
- Wiring may create webhook stubs even when the vault is unreadable.
  `--noWire` skips both the name check and the stubs.

For each required missing secret, obtain the real value from its provider and
run `phantom add <NAME>` in a trusted terminal, entering the value when
prompted. Replace `<NAME>` with the secret name; do not put the value in the
command arguments. See [troubleshooting](apply-troubleshooting.md) for
recovery and [placeholder history](apply-placeholder-history.md) for more
detail. Check the documentation for the installed version before relying on
source-version behavior.
