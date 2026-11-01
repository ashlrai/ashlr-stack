# Review checklist: `stack apply` changelog entries

Compare the **`stack apply` stops attempting to write placeholder secrets.**
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
  Follow the [update procedure](changelog-update-procedure.md) to reconcile,
  sync and test any changes, and inspect the resulting diff.

For a whole-file comparison before syncing, run from the repository root:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files match; status 1 shows differences,
and a higher status indicates an error. Review each relevant entry in context
whether or not the files match.
