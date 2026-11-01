# `stack apply` changelog source comparison

This compares the checked-in entries for the placeholder-secret wiring fix:

- [Root changelog: 0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16)
- [Site changelog data: 0.2.1 (2026-10-16)](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)

In each file, the entry is the first bullet under **Bug fixes**, beginning
“`stack apply` stops attempting to write placeholder secrets.” The links point
to the release heading.

**Substantive wording differences: none.** The complete entry is identical in
both checked-in sources, including its commands, result fields and historical
explanation. Both distinguish wiring's name checks from provider setup, which may
store real values; describe supplying required missing values through Phantom;
and say an unreadable vault results in providers being reported as skipped.
Both also describe the failed placeholder-add attempts and the replacement of
`WireResult.envelopes` with `present` and `missing`.

The Unreleased, 0.3.0 and 0.1.0 apply notes provide other context; they are not
the 0.2.1 fix entry compared here. This comparison does not establish what is
installed or deployed. The site sync copies the root changelog to the site data,
so compare the checked-in files before running a sync:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files match; status 1 means differences,
and a higher status indicates an error. Review any changes to the entry and
update this comparison accordingly.
