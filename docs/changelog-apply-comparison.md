# Comparison of the apply changelog entries

The [repository changelog](../CHANGELOG.md#021-2026-10-16) and the
[site changelog data](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)
each contain the entry **`stack apply` stops attempting to write placeholder
secrets.** It is the first bullet under **0.2.1 (2026-10-16) → Bug fixes**.
The two entries are identical in the checked-in files. This is a comparison of
that fix, not of every apply-related note or of a deployed site.

**Wording differences: none.** The complete entries match byte for byte,
including punctuation, Markdown formatting, command examples, and the issue
reference. The entire checked-in changelog files also match byte for byte.

| Topic | What both entries say |
| --- | --- |
| Wiring and setup | Wiring does not write to the vault or fill missing values; provider setup may separately store real values. |
| Required values | Users supply each required missing value through Phantom in a trusted terminal. |
| Readable vault | Wiring checks names with `phantom list --json`, reports present and missing counts and lists missing names. |
| Unreadable vault | Providers are reported as skipped, rather than identified as missing. |
| Previous behavior | Placeholder-add attempts failed; the printed `envelopes` count was always zero. |
| Result fields | `WireResult.envelopes` was replaced by `present` and `missing`. |

The site data is a copy of the root changelog, synchronized before site builds
and development. Check both committed files before synchronizing: a sync can
overwrite a difference. The [mirror review](changelog-mirror-review.md)
describes how to locate the entry and compare the files. Other apply notes,
including the Unreleased and 0.3.0 sections, provide additional context and
are not the 0.2.1 fix entry.

To repeat the comparison before a site sync, run from the repository root:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files match; status 1 shows differences,
and a higher status indicates an error. Inspect any changes in the 0.2.1 fix
entry to update this comparison.
