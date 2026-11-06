# Site changelog: apply placeholder timeline

The [site changelog's 0.2.1 bug fix](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)
records when `stack apply` stopped **attempting** to write placeholder secrets.
The entry is the first bullet under **Bug fixes** in that release. The site
data is copied from the [root changelog](../CHANGELOG.md) by the site's
`sync-content` script; these are two copies of the same history.

| Entry | Recorded change |
| --- | --- |
| [0.1.0](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) | The apply description says wiring historically attempted a `TODO_STACK_APPLY` placeholder for each declared secret. Those calls failed. |
| [0.2.1 (2026-10-16)](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | The bug fix removed those attempts. Phantom refused values in arguments and did not support `--rotate`; the old `envelopes` count was always zero. `WireResult.envelopes` was replaced by `present` and `missing`. |
| [0.2.2 (2026-10-25)](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) | 0.2.1 was tagged but its npm publish failed. The 0.2.2 entry says it ships the 0.2.1 changes. |
| [0.3.0 (2026-10-31)](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) | Wiring checks existing secret names without filling values. An unreadable vault means providers are reported as skipped, not missing. |
| [Unreleased](../packages/site/src/data/CHANGELOG.md#unreleased) | After at least one provider succeeds, wiring checks every recipe provider, including failed ones, and can create webhook stubs even if the vault is unreadable. |

Wiring does not fill missing values; provider setup may store real credentials
separately. Supply each required missing value with `phantom add <NAME>` in a
trusted terminal. A missing name alone does not fail apply, but provider
failures do. `--noWire` skips the wiring checks and webhook stubs.

For the broader history and related guidance, see the
[placeholder-secret timeline](changelog-placeholder-timeline.md).
