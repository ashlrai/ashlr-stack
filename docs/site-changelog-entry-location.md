# Where to find the site changelog entry

The placeholder-removal entry appears in both [the root changelog](../CHANGELOG.md)
and [the site changelog data](../packages/site/src/data/CHANGELOG.md). In each,
look under **0.2.1 (2026-10-16) → Bug fixes** for the first bullet,
**`stack apply` stops attempting to write placeholder secrets.** These are two
copies of the same entry. The site renders its data file at `/docs/changelog`;
its `sync-content` script copies the root changelog over the site file before
site development and builds.

From the repository root, find both copies before running the sync script:

```sh
grep -n -F 'stops attempting to write placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Expect exactly one result per file in the release and subsection above. A
successful search alone is insufficient: it also succeeds if only one file
matches. Investigate missing or duplicate matches and read each complete bullet.

Compare the descriptions and their qualifications: wiring neither writes to the
vault nor fills missing values; provider setup may store real values separately;
users supply required missing values through Phantom; a readable vault allows
name checks, while an unreadable vault causes providers to be reported as
skipped. Both entries should also agree about the failed historical placeholder
attempts and the replacement of `WireResult.envelopes` by `present` and
`missing`. Resolve substantive discrepancies against the implementation, rather
than assuming either copy is correct.

For a whole-file comparison, run:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files are identical; status 1 means they
differ, and a higher status indicates an error. Review differences before
syncing, because syncing overwrites the site copy. After correcting the root
source, run `bun run --cwd packages/site sync-content` and inspect the diff.
Then run `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts` to
check the entry and whole-file parity. This checks repository files, not a
deployed site. The Unreleased and 0.3.0 apply notes and the older recipe
description add context; they are not the 0.2.1 removal entry.

For the wider history, see [the placeholder timeline](changelog-placeholder-timeline.md).
