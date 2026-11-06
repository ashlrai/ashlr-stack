# `stack apply` placeholder removal

Source: the [0.2.1 bug fix in CHANGELOG.md](../CHANGELOG.md#021-2026-10-16),
restated in the Unreleased and 0.3.0 entries.

## Former behavior

After the providers ran, `stack apply` wiring tried to write a stand-in value
for every secret the recipe declared. It ran
`phantom add <KEY> TODO_STACK_APPLY --rotate`, then tried again without
`--rotate`. Phantom Secrets has no `--rotate` option and refuses values in
command arguments, so both attempts failed. Nothing was stored, and the
reported `envelopes` count was always zero. These commands are historical, not
instructions to run.

## Documented change

- Wiring never writes to the vault and never fills in missing values.
- With a readable vault, it checks secret names with `phantom list --json` and
  prints `secrets in vault N · missing M · webhooks K`, plus a `not in Phantom:`
  line for missing names.
- With an unreadable vault, it reports providers as skipped instead of
  identifying missing names.
- `WireResult.envelopes` is replaced by `present` and `missing`.
- Missing names alone do not fail apply; provider failures do. An applied
  recipe is not proof that every required secret is present.
- Provider setup may separately store real values. `--noWire` skips both the
  name checks and the webhook stubs.

## What to do about a missing secret

For each name listed as missing, run `phantom add <NAME>` in a trusted terminal
and enter the real value when prompted.
