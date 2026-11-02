# Reading the `stack apply` placeholder entry

The [0.2.1 bug fix](../CHANGELOG.md#021-2026-10-16) describes a historical
attempt by apply wiring: `phantom add <KEY> TODO_STACK_APPLY --rotate`, followed
by a retry without `--rotate`. These are not commands to run. Both attempts
failed because Phantom Secrets refuses values in command arguments and has no
`--rotate` option; the old `envelopes` count was always zero.

The fix stopped wiring from attempting to write placeholder secrets. Wiring
checks existing names with `phantom list --json` and reports present and
missing names when the vault is readable; if it cannot read the vault, it
reports providers as skipped instead of identifying missing names. Wiring does
not write to the vault or fill missing values, though provider setup may store
real values separately. For each required missing secret, run
`phantom add <NAME>` in a trusted terminal and enter the real value.
`WireResult.present` and `WireResult.missing` replaced `WireResult.envelopes`.

The [0.2.2 entry](../CHANGELOG.md#022-2026-10-25) says 0.2.1 was tagged but
not published to npm, and 0.2.2 includes its changes. Check the installed
version's help before relying on release-specific behavior.
