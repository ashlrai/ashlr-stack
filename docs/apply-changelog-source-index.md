# `stack apply` changelog source index

The repository [changelog](../CHANGELOG.md) is copied to the [site changelog
source](../packages/site/src/data/CHANGELOG.md) by the site's content sync.
Both checked-in files contain these entries about the placeholder-secret change:

| Release and heading | Repository | Site source | Entry |
| --- | --- | --- | --- |
| Unreleased → Changed | [Open](../CHANGELOG.md#unreleased) | [Open](../packages/site/src/data/CHANGELOG.md#unreleased) | Current wiring behavior, including provider failures and `--noWire`. |
| 0.3.0 (2026-10-31) → Changed and fixed; Changed | [Open](../CHANGELOG.md#030-2026-10-31) | [Open](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) | Summary and detailed explanation of checking secret names without creating placeholders. |
| 0.2.1 (2026-10-16) → first Bug fixes | [Open](../CHANGELOG.md#021-2026-10-16) | [Open](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | First bullet: `stack apply` stops attempting to write placeholder secrets. |
| 0.1.0 → AI recommendation layer — `stack recommend` + `stack apply` | [Open](../CHANGELOG.md#010--2026-04-19-superseded-by-011) | [Open](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) | Original command description with annotated wiring history. |

Links target release headings because subsection names repeat. These links
describe checked-in content, not the installed or deployed version. For other
`stack apply` changes, see [changelog source locations](changelog-source-locations.md).

## The 0.2.1 placeholder fix

The entry that removed `stack apply`'s attempted placeholder-secret writes sits
under the same release, subheading and bullet text in both checked-in changelogs:

| Source | Release heading | Subheading | Entry |
| --- | --- | --- | --- |
| [Repository changelog](../CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` | `Bug fixes` | **`stack apply` stops attempting to write placeholder secrets.** |
| [Site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` | `Bug fixes` | **`stack apply` stops attempting to write placeholder secrets.** |

In each release section, open the first **Bug fixes** subheading. The entry is
its first bullet. The links target the release heading because 0.2.1 has two
Bug fixes subheadings. The two checked-in entries match.

This is the version recorded for the change. It does not prove which version is
installed or deployed. The [0.2.2 release notes](../CHANGELOG.md#022-2026-10-25)
say 0.2.1 was tagged but its npm publish failed, and 0.2.2 includes its changes.
