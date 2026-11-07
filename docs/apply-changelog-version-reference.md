# Apply placeholder removal: changelog version reference

Both checked-in changelogs record the removal of `stack apply`'s attempted
placeholder-secret writes under **0.2.1 (2026-10-16)**:

| Source | Version heading |
| --- | --- |
| [Repository changelog](../CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` |
| [Site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` |

In each version section, open **Bug fixes** and find its first bullet,
“`stack apply` stops attempting to write placeholder secrets.” The links target
the version heading because `Bug fixes` occurs in multiple sections.

This is the version recorded for the change, not proof of an installed or
deployed version. The [0.2.2 release notes](../CHANGELOG.md#022-2026-10-25)
say 0.2.1 was tagged but its npm publish failed, and 0.2.2 includes its changes.
