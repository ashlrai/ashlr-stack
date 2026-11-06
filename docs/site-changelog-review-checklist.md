# Site changelog entry review checklist

Use this checklist to compare corresponding entries in the [root changelog](../CHANGELOG.md)
and the [site data copy](../packages/site/src/data/CHANGELOG.md), which is rendered
at `/docs/changelog`. Review the checked-in files before syncing: the site's
`sync-content` script copies the root over the site file, potentially hiding a
discrepancy. The root is the source to correct when a change is needed.

- [ ] **Find the same change in each file.** Match the release or Unreleased
  heading, date, subsection, and subject. Check for missing or duplicate entries;
  similarly named changes in other releases may describe different behavior.
- [ ] **Read each complete entry in context.** Include continuation paragraphs,
  nested lists, examples, links, and qualifications. Compare the claimed behavior,
  affected commands and flags, preconditions, failure cases, user actions, and
  compatibility or historical notes. Verify substantive conflicts against the
  implementation or other authoritative evidence before deciding on a correction.
- [ ] **Check meaning and presentation.** Make sure commands, identifiers, versions,
  dates, links, and examples are accurate and usable, and that Markdown renders
  clearly. Equivalent wording and different surrounding text do not by themselves
  make corresponding entries disagree; do not treat unrelated differences as part
  of the entry under review.
- [ ] **Resolve and verify.** Correct the root source as needed, sync with
  `bun run --cwd packages/site sync-content`, and inspect the entire resulting diff
  for unintended changes. The sync command tolerates a missing source, so check its
  output files and diff even if it succeeds. Run
  `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts` from the repo
  root. This existing test also requires whole-file equality and pins specific
  wording; a failure outside the reviewed entry needs separate investigation.
  Neither a source comparison nor this test proves a site deployment or release.

## Worked example: placeholder-secret fix

Find the entry before syncing, from the repository root:

```sh
grep -n -F 'stops attempting to write placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Expect exactly one match per file under **0.2.1 (2026-10-16) → Bug fixes**;
search success alone can mean only one file matched. Read the whole bullet in
each file. Check that both describe wiring as neither writing placeholders nor
filling missing values, distinguish provider setup storing real values, and tell
users to supply required missing values through Phantom. Compare the readable
and unreadable vault cases, the failed historical attempts, and the replacement
of `WireResult.envelopes` by `present` and `missing`. The Unreleased and 0.3.0
apply notes are related context, not this same entry.

For a whole-file comparison, use [the mirror review guide](changelog-mirror-review.md).
That broader check is separate from deciding whether these two entries agree.
