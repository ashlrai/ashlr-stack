# Changelog entry source reference

The `stack apply` placeholder-secret fix is the first bullet under
**0.2.1 (2026-10-16) → Bug fixes** in both the
[root changelog](../CHANGELOG.md#021-2026-10-16) and the
[site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16).
The matching entry starts **`stack apply` stops attempting to write placeholder
secrets.** It explains the removed placeholder attempts, the secret-name
check, and what happens when the vault cannot be read.

To find it in either file, navigate to the level-two heading `0.2.1
(2026-10-16)`, then the level-three heading `Bug fixes`, and read its first
bullet. Search within the release section: other releases and the earlier
0.2.1 notes also have a `Bug fixes` heading. The links above target the release
heading, so they do not depend on an ambiguous subsection anchor or a line
number that can move as the changelog grows.

The root changelog is copied to the site data file by the site's `sync-content`
script. The checked-in files currently match; compare them before syncing,
since syncing overwrites the site copy. The [source map](site-changelog-source-map.md)
locates the other `stack apply` entries, including the later 0.3.0 and
Unreleased notes. These files do not establish what is deployed.
