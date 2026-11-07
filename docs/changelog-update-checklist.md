# Changelog update checklist

Use this when adding or correcting release notes. The root [CHANGELOG.md](../CHANGELOG.md)
is the source; [packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md)
is the checked-in copy rendered by the site.

- [ ] Before editing or syncing, compare both files from the repository root:

  ```sh
  diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
  ```

  No output and exit status 0 mean the files match; status 1 means differences,
  and a status greater than 1 means an error. Read each difference in context,
  including site-only changes, before deciding what belongs in the source.
- [ ] Find the affected release and subsection in **both** files. Compare the
  corresponding historical entries in full, including conditions, examples,
  links and continuation paragraphs; check for missing or duplicate entries.
  Also review related entries in other releases for consistency without erasing
  the distinction between historical and current behavior. For example, compare
  **0.1.0 → AI recommendation layer** (`stack apply [recipe-id]`) and **0.2.1 →
  Bug fixes** (`stack apply` stops attempting to write placeholder secrets) in
  each copy. The first describes the original attempt and the second its removal.
- [ ] Verify the intended wording against the implementation or other evidence,
  update the root source, and preserve unrelated release history. Identical
  copies alone do not establish that their claims are correct.
- [ ] After reconciling differences, run `bun run --cwd packages/site sync-content`
  from the repository root. This overwrites the entire site copy; site `dev`,
  `start`, and `build` also run it. The sync script suppresses copy errors, so
  repeat the `diff -u` above and require status 0. Review
  `git diff -- CHANGELOG.md packages/site/src/data/CHANGELOG.md` for unintended
  changes.
- [ ] Run `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts` to
  check the checked-in copies and historical claims. This does not verify a
  deployed site.

See the [update procedure](changelog-update-procedure.md) for more detail.
