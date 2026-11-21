# Site changelog review

Use this guide when reviewing a change to the [site changelog](../packages/site/src/data/CHANGELOG.md),
including changes copied from the [root changelog](../CHANGELOG.md). The root
file is the source: the site's `sync-content` script copies it over the site
file before development and builds, and `/docs/changelog` renders that copy.
Review the checked-in files before syncing, because syncing overwrites the site
copy and can hide a discrepancy. When a change is needed, correct the root.

## Checklist

- [ ] **Find the same change in each file.** Match the release or Unreleased
  heading, date, subsection, and subject. Check for missing or duplicate entries;
  similarly named changes in other releases may describe different behavior.
- [ ] **Read each complete entry in context.** Include continuation paragraphs,
  nested lists, examples, links, and qualifications. Compare the claimed behavior,
  affected commands and flags, preconditions, failure cases, user actions, and
  compatibility or historical notes. Verify substantive conflicts against the
  implementation or other authoritative evidence, rather than assuming either
  copy is correct.
- [ ] **Heading order.** Keep `# Changelog` first, `## Unreleased` before
  released versions, and released versions newest first. Check the version and
  date against the root entry. Use `###` for subsections under the appropriate
  release; keep any deeper headings nested without skipping levels. Existing
  historical heading styles need not be rewritten.
- [ ] **Meaning and presentation.** Make sure commands, identifiers, versions,
  dates, links, and examples are accurate and usable. Review the rendered
  `/docs/changelog` page (for example, with `bun run --cwd packages/site dev`):
  headings, lists, links, inline code, and fenced examples should render as
  intended, with no broken nesting, unclosed fences, or accidental headings.
  Equivalent wording and different surrounding text do not by themselves make
  corresponding entries disagree. Do not infer that a version is published
  merely because it appears in source.
- [ ] **Resolve and verify.** Correct the root source as needed, sync with
  `bun run --cwd packages/site sync-content`, and inspect the entire resulting
  diff. The sync command tolerates a missing source, so check its output files
  and diff even if it succeeds. Then run
  `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts` from the
  repository root. That test requires whole-file equality and pins specific
  wording; a failure outside the reviewed entry needs separate investigation.
  Neither a source comparison nor this test proves a site deployment or release.

## Worked example: placeholder-secret fix

The [root changelog](../CHANGELOG.md#021-2026-10-16) and the
[site data copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) each
record the change under **0.2.1 (2026-10-16) → Bug fixes**, as the first bullet:
**`stack apply` stops attempting to write placeholder secrets.** These are two
copies of the same entry. From the repository root, find both before syncing:

```sh
grep -n -F 'stops attempting to write placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Expect exactly one match per file in the release and subsection above. A
successful search alone is insufficient: it also succeeds if only one file
matches. Investigate missing or duplicate matches and read each complete bullet.

Check that both copies say wiring neither writes to the vault nor fills missing
values; that provider setup may store real values separately; that users supply
required missing values through Phantom; and that a readable vault allows name
checks, while an unreadable vault causes providers to be reported as skipped.
Both should also agree about the failed historical placeholder attempts and the
replacement of `WireResult.envelopes` by `present` and `missing`.

The two complete files are currently byte-for-byte identical, so there are no
wording differences between their copies of the entry. The later **0.3.0 →
Changed** and **Unreleased → Changed** notes describe the same behavior with
different detail: the Unreleased note specifies that, after at least one
provider succeeds, wiring checks all recipe providers, can create webhook stubs
even with an unreadable vault, and is skipped entirely with `--noWire`. These
are related context from other sections, not the 0.2.1 removal entry, and not
differences between the two files.

## Whole-file comparison

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files are identical; status 1 means they
differ, and a higher status indicates an error. Review any differences in
context before updating the root and syncing. This is separate from deciding
whether two entries agree; for the full mirroring procedure, see
[the mirroring guide](changelog-mirroring.md). These checks cover repository
files, not a deployed site. For the wider history, see the
[placeholder timeline](changelog-placeholder-timeline.md).
