# Site changelog: `stack apply` placeholder change

In the [site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16),
the first bullet under **0.2.1 (2026-10-16) → Bug fixes** is titled
**`stack apply` stops attempting to write placeholder secrets.**

The entry says wiring no longer writes to the vault or fills missing values.
Provider setup may separately store real values. Users must supply each required
missing value through Phantom, using `phantom add <NAME>` in a trusted terminal.
When the vault is readable, wiring checks secret names with `phantom list --json`
and reports present and missing counts and missing names. If it cannot read the
vault, it reports providers as skipped instead of identifying missing names.

Previously, wiring attempted to add a placeholder for every declared secret.
Those attempts failed because Phantom refused values in command arguments and
did not support the attempted `--rotate` flag. The entry says the resulting
`envelopes` count was always zero, and `WireResult.envelopes` was replaced by
`present` and `missing`.

The site's **Unreleased → Changed** entry adds that wiring runs after at least
one provider succeeds and checks every recipe provider, including failed ones.
Missing names alone do not fail apply, while provider failures do. Wiring can
also create webhook stubs even if the vault is unreadable; `--noWire` skips both
the checks and the stubs. These are later clarifications, not claims that the
0.2.1 entry itself makes.

The site data is copied from the [root changelog](../CHANGELOG.md#021-2026-10-16)
by the site's `sync-content` script. This reference describes the checked-in
data, not an installed version or what is currently deployed.
