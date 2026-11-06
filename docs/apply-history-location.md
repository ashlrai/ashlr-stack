# Where to find the `stack apply` history

The root changelog is the source; the site keeps a copy. Both contain these
entries:

1. **0.1.0, AI recommendation layer:** the `stack apply [recipe-id]` bullet
   introduces recipe application. Read it in the [root changelog](../CHANGELOG.md#010--2026-04-19-superseded-by-011)
   or the [site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011).
   Its current wording includes later annotations, so it is not an unchanged
   description of the original behavior.
2. **0.2.1, Bug fixes:** the `stack apply` placeholder-secret bullet records the
   change that stopped placeholder writes. Read it in the [root changelog](../CHANGELOG.md#021-2026-10-16)
   or the [site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16).

Originally, wiring attempted to add `TODO_STACK_APPLY` for each declared secret.
Phantom rejected those attempts, so they did not create placeholders; the
reported `envelopes` count was always zero. The 0.2.1 fix removed the attempts
and replaced `WireResult.envelopes` with `present` and `missing`. Wiring checks
secret names without writing values; provider setup may separately store real
credentials. Supply required missing values through Phantom in a trusted terminal.

The [0.2.2 release note](../CHANGELOG.md#022-2026-10-25) says 0.2.1 was tagged
but its npm publish failed; 0.2.2 superseded it and shipped its changes. Check
the installed version before applying this history to an installation. For
current behavior and recovery, see [the placeholder history](apply-placeholder-history.md)
and [apply troubleshooting](apply-troubleshooting.md).
