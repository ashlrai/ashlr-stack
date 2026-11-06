# Apply placeholder fix: changelog source map

The `stack apply` placeholder-secret removal is recorded in both checked-in
changelogs. In each file, follow the release link, then find the first **Bug
fixes** subheading and its first bullet:

| Source | Release heading | Subheading | Entry |
| --- | --- | --- | --- |
| [Repository changelog](../CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` | `Bug fixes` | **`stack apply` stops attempting to write placeholder secrets.** |
| [Site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | `0.2.1 (2026-10-16)` | `Bug fixes` | **`stack apply` stops attempting to write placeholder secrets.** |

The links target the release heading because `Bug fixes` occurs more than once,
including twice within 0.2.1. The entries match in the checked-in files. The
site build copies the repository changelog into the site data file; this map
does not establish what is deployed or installed. Version 0.2.1 was tagged but
never published; the fix first shipped in 0.2.2. For other apply entries, see the
[site changelog source map](site-changelog-source-map.md).
