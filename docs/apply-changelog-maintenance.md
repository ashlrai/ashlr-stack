# Maintaining historical `stack apply` notes

[CHANGELOG.md](../CHANGELOG.md) is the source of release notes; the checked-in
[site copy](../packages/site/src/data/CHANGELOG.md) is rendered on the site.
Review both before running the site `dev`, `start`, `build`, or `sync-content`
scripts: they copy the root changelog over the site copy.

From the repository root:

1. Compare the copies with `diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md`.
   Exit 0 means they match; exit 1 shows differences; a higher status means an
   error. Investigate site-only changes before overwriting them.
2. Search both files for `stack apply`, `Apply wiring`, `TODO_STACK_APPLY`, and
   `phantom-wire`; read each match in its release section, including examples.
   In particular, compare 0.1.0's original description, the 0.2.1 placeholder
   fix, 0.2.2's provider-failure and missing-recipe fixes, 0.3.0's wiring
   examples, and Unreleased's partial-failure detail. Check equivalent claims
   and qualifications across releases as well as between copies. Historical
   attempts to write placeholders failed; the 0.2.1 fix removed the attempts.
   Preserve that chronology rather than treating old behavior as current.
3. Resolve discrepancies against the relevant implementation, tests, and change
   history. Equal copies alone do not prove correctness. Make intended corrections
   in the root file, preserve historical context, and sync the site copy with
   `bun run --cwd packages/site sync-content`. Repeat the diff and inspect
   `git diff -- CHANGELOG.md packages/site/src/data/CHANGELOG.md`; the sync
   overwrites the whole copy and suppresses copy errors.
4. Run `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts scripts/apply-changelog.test.ts`
   to check the copies and documented behavior. These checks cover the checkout,
   not a deployed site or an installed release.

## Review checklist for the 0.2.1 entry

Use this checklist in step 2 for the **`stack apply` stops attempting to write placeholder secrets.**
entry under **0.2.1 (2026-10-16) → Bug fixes** in both the
[root changelog](../CHANGELOG.md#021-2026-10-16) and the
[site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16).
These are corresponding entries in checked-in files; this review does not
verify a deployed site or an installed release.

- [ ] **Locate both entries.** Confirm each file has one matching bullet in the
  stated release and subsection. Read the complete bullet, including historical
  details, and compare what each says `stack apply` does. Investigate any missing,
  duplicate, or conflicting claim before copying either file.
- [ ] **Compare secret handling.** Do both distinguish wiring, which does not
  write to the vault or fill missing values, from provider setup, which may
  store real values? Do both say users supply required missing values through
  Phantom in a trusted terminal?
- [ ] **Compare the two vault outcomes.** For a readable vault, check the name
  inventory, present/missing counts and list of missing names. For an unreadable
  vault, check that providers are reported as skipped, not as missing. Check the
  historical failed placeholder attempts and the replacement of
  `WireResult.envelopes` with `present` and `missing`.
- [ ] **Check current context.** Read **Unreleased → Changed** and **0.3.0 →
  Changed** in both files as well. Compare the conditions for wiring, its scope
  across recipe providers including failures, the effects of missing names and
  provider failures, webhook stubs, and `--noWire`. Check that the historical
  fix and later notes do not give readers a misleading picture together.
- [ ] **Resolve and verify differences.** Check disputed behavior against the
  implementation or tests; matching text alone does not prove it is correct.
  The root changelog is the source for the site copy. Review differences before
  running site build, dev, or `sync-content`, which overwrite the site copy.
  Follow the [mirroring guide](changelog-mirroring.md#maintainer-rule) to reconcile,
  sync and test any changes, and inspect the resulting diff.

Review each relevant entry in context whether or not the whole-file diff in
step 1 shows a match.
