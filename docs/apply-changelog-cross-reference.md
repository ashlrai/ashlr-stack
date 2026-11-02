# `stack apply` changelog cross-reference

The placeholder-secret wiring fix appears in both checked-in changelogs:

- [Repository changelog: 0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16)
- [Site changelog data: 0.2.1 (2026-10-16)](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)

In each, the entry is the first bullet under the first **Bug fixes** heading,
starting “`stack apply` stops attempting to write placeholder secrets.” The
links lead to the release heading because the section heading is repeated.

Both entries describe the same change: apply wiring stopped attempting to
write placeholder secrets and instead checks existing secret names without
filling missing values. Earlier placeholder-add attempts failed. Provider setup
may separately store real values; if the vault is unreadable, wiring reports
providers as skipped rather than identifying missing names.

These references describe the checked-in changelogs, not an installed or
deployed version.
