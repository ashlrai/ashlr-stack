# Apply changelog mirror checklist

Use this checklist to review the shared `stack apply` placeholder-secrets fix in
the [root changelog](../CHANGELOG.md) and the [site copy](../packages/site/src/data/CHANGELOG.md).
The site `sync-content` script copies the root file over the site copy before a
site build or dev server starts. Inspect both checked-in files before running it,
or the copy may hide a difference.

- [ ] From the repository root, locate the fix in both files:

  ```sh
  grep -n -F 'stops attempting to write placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
  ```

  Expect one result per file, under **0.2.1 (2026-10-16) → Bug fixes**.
  Search success alone is insufficient: a match in only one file also succeeds.
  Investigate missing or duplicate results. Other apply entries, including
  Unreleased and 0.3.0, are separate context, not this fix.
- [ ] Read the entire bullet in each file, including any continuation paragraphs,
  and compare their meaning and qualifications. Check that wiring does not write
  placeholders or fill missing values, provider setup may store real values, and
  required missing values need user action through Phantom. Check the readable
  and unreadable vault cases, the historical failed attempts, and the result
  fields. Resolve a difference in this entry against the implementation before
  updating the appropriate copy.
- [ ] Keep the review scoped to this entry: its agreement does not establish that
  unrelated entries or the complete files are identical. If syncing the site
  copy, review the resulting whole-file diff for unintended changes.
- [ ] Run `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts`.
  This existing test checks whole-file equality as well as the apply entry; a
  failure elsewhere requires separate investigation. It checks source files,
  not whether a site build or release has been deployed.

For a wider comparison, see [Reviewing the changelog mirror](changelog-mirror-review.md).
