# Apply migration questions for operators

Questions an operator asks when upgrading to a `stack apply` that no longer
writes placeholder secrets. Answers come only from the
[changelog](../CHANGELOG.md), which describes the code across releases, not
your vault or your installed copy. Check `stack --version` and
`stack apply --help` first.

## Where is the removal recorded?

- [0.2.1](../CHANGELOG.md#021-2026-10-16): wiring stopped running
  `phantom add <KEY> TODO_STACK_APPLY --rotate`. 0.2.1's npm publish failed;
  [0.2.2](../CHANGELOG.md#022-2026-10-25) ships it.
- [0.3.0](../CHANGELOG.md#030-2026-10-31) and
  [Unreleased](../CHANGELOG.md#unreleased): name-checking wiring, with the
  missing-secret example output and the unreadable-vault case.

## Do I have placeholder values to clean up?

The changelog prescribes no cleanup. Every placeholder call failed and the
printed `envelopes` count was always 0, so it records no apply-written
placeholders. Whether your vault holds one is not answered there; run
`phantom list --json` to look.

## Why does apply succeed while secrets are missing?

A missing name alone does not fail apply; provider failures do. Read the
`secrets in vault N · missing M · webhooks K` line and the `not in Phantom:`
list rather than the exit status.

## How do I supply a missing secret?

Run `phantom add <NAME>` in a trusted terminal and enter the real value when
prompted. Never pass it as a command argument; apply writes nothing for you.

## What if the vault is unreadable?

Providers are reported as skipped, not missing, so no names are listed. Fix
vault access and re-run; the changelog does not claim a skipped provider has
its secrets.

## Is a re-run safe?

It is a real operation, not an inspection: apply re-runs provider setup for
every recipe provider and can create webhook stubs even when the vault is
unreadable. `--noWire` skips both the name check and the stubs.

## Does anything else store credentials?

Provider setup may store real values through its own workflow, separately
from wiring.

## Related

- [Placeholder migration questions](apply-placeholder-migration-questions.md)
- [Migration checklist](apply-placeholder-migration.md)
- [Troubleshooting](apply-troubleshooting.md)
