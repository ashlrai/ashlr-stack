# Apply placeholder wiring: changelog version map

The entry describing the removal of `stack apply`'s attempted placeholder-secret
writes appears under the same version heading in both checked-in changelogs:

| Source | Version heading | Location within the version |
| --- | --- | --- |
| [Repository changelog](../CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` | `Bug fixes` — `stack apply` stops attempting to write placeholder secrets |
| [Site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` | `Bug fixes` — `stack apply` stops attempting to write placeholder secrets |

The links lead to the version heading; the entry is the first bullet under its
first `Bug fixes` subheading. The changelog says 0.2.1 was tagged but not
published to npm, and that 0.2.2 includes its changes. The site build copies the
repository changelog to the site data file, so this map describes the checked-in
sources, not the version currently deployed or installed.
