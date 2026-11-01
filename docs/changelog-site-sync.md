# Keeping the site changelog in sync

[The root changelog](../CHANGELOG.md) is the source of release notes. The site
renders the checked-in [site copy](../packages/site/src/data/CHANGELOG.md) at
`/docs/changelog`. The site's `sync-content` script copies the whole root file
over the site copy during `dev`, `start`, and `build`; it is not a two-way
merge. Review both files before running those commands, since copying first can
erase evidence of a site-only change.

From the repository root:

1. Find the change in **both** files by its distinctive text, then read the
   complete entry and any continuation paragraphs under the same release and
   subsection in each. For example, the placeholder-removal fix is under
   **0.2.1 (2026-10-16) → Bug fixes**:

   ```sh
   grep -n -F 'stops attempting to write placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
   ```

   Expect one match per file. A successful search can still have a match in
   only one file; investigate missing or duplicate entries. Compare behavior,
   conditions, examples, and links, not just the entry title. Other releases
   may discuss the same feature without describing the same change.
2. Compare the entire checked-in files, including unrelated entries:

   ```sh
   diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
   ```

   No output and exit status 0 mean byte-for-byte equality. Status 1 reports
   differences (`-` is root, `+` is site); status greater than 1 indicates an
   error, such as a missing file. Investigate each hunk in context before
   deciding what belongs in the root source. Matching copies alone do not prove
   a claim is correct; check the implementation or other evidence when needed.
3. Make any intended correction in the root changelog, then synchronize the
   site copy from the root:

   ```sh
   bun run --cwd packages/site sync-content
   ```

   The script suppresses copy errors, so its exit status alone does not prove
   synchronization succeeded. Repeat the `diff` above and inspect
   `git diff -- CHANGELOG.md packages/site/src/data/CHANGELOG.md` for unintended
   changes. Resolve any remaining difference before proceeding.
4. Run the existing mirror and entry checks:

   ```sh
   HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts
   ```

   These checks cover repository files, not whether a particular site build has
   been deployed. For the historical apply fix, see the more detailed
   [mirror review](changelog-mirror-review.md).
