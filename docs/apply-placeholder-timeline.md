# `stack apply` placeholder timeline

This timeline follows the repository changelog. It describes attempted writes,
not successful placeholder storage; check the installed version before assuming
that a particular release's behavior applies.

| Changelog entry | Documented behavior |
| --- | --- |
| [0.1.0 — 2026-04-19](../CHANGELOG.md#010--2026-04-19-superseded-by-011), AI recommendation layer | The apply entry, as annotated in the current changelog, says wiring historically attempted a `TODO_STACK_APPLY` placeholder for each declared secret. The calls failed, and the 0.2.1 fix removed the attempts. |
| [0.2.1 — 2026-10-16](../CHANGELOG.md#021-2026-10-16), Bug fixes | Wiring stopped attempting placeholder writes. Previously it ran `phantom add <KEY> TODO_STACK_APPLY --rotate`, then the form without `--rotate`, for every declared secret. Phantom refused values in command arguments and did not have `--rotate`; every call failed and the printed `envelopes` count was always zero. The fix replaced `WireResult.envelopes` with `present` and `missing`. These commands are historical; do not run them. |
| [0.2.2 — 2026-10-25](../CHANGELOG.md#022-2026-10-25) | The changelog says 0.2.1 was tagged but its npm publish failed; 0.2.2 superseded it and ships the changes listed under 0.2.1. |
| [0.3.0 — 2026-10-31](../CHANGELOG.md#030-2026-10-31), Changed | Wiring checks secret names without writing placeholders or filling missing values. A readable vault yields present and missing names; an unreadable vault yields skipped providers, not a finding that names are missing. Provider setup may separately store real credentials. |
| [Unreleased](../CHANGELOG.md#unreleased), Changed | After at least one provider succeeds, wiring checks names for every provider in the recipe, including failed providers, and can create webhook stubs even if the vault is unreadable. Missing names alone do not fail apply; provider failures do. `--noWire` skips both checks and stubs. |

For each required missing value, run `phantom add <NAME>` in a trusted terminal,
substituting the secret name and entering its real value. A successful apply
alone does not establish that all required secrets are present. See the
[migration checklist](apply-placeholder-migration.md) for interpreting an
existing result.
