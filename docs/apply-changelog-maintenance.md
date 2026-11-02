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
