# Changelog mirroring

Release notes live in two checked-in copies:

| Copy | Path | Role |
| --- | --- | --- |
| Root | [`CHANGELOG.md`](../CHANGELOG.md) | Source of truth |
| Site | [`packages/site/src/data/CHANGELOG.md`](../packages/site/src/data/CHANGELOG.md) | Mirror rendered at `/docs/changelog` |

The site's `sync-content` script (run by `dev`, `start` and `build`) copies the
root file over the site copy. Nothing merges the other direction, so an edit
made only to the site copy is lost on the next build. Review both files before
running those commands, since copying first can erase evidence of a site-only
change.

Agent PRs follow the same flow: add lines under `## Unreleased` only and mirror
the site copy. See the [changelog rule](../AGENTS.md#changelog) in AGENTS.md.

## Maintainer rule

Keep both copies consistent. Edit `CHANGELOG.md` first, then update the site
copy to match. Do not change the wording, conditions or examples of an entry in
only one file.

1. [Review both copies](#review-before-syncing) before editing or syncing.
2. Edit the root `CHANGELOG.md`, normally under `Unreleased` in the
   appropriate subsection. Check the wording against the change it describes,
   and preserve unrelated entries and release history.
3. Sync: `bun run --cwd packages/site sync-content`. This overwrites the whole
   site copy, and the script suppresses copy errors (`|| true`), so its exit
   status alone does not prove the copy worked. Repeat the `diff` below and
   require status 0, then inspect
   `git diff -- CHANGELOG.md packages/site/src/data/CHANGELOG.md` for
   unintended changes.
4. Run the checks:
   `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts scripts/changelog-mirroring.test.ts`.
   They cover the checked-in files and specific historical claims, not whether
   a site build has been deployed.

## Review before syncing

From the repository root, find a change in **both** files by its distinctive
text. For example, the 0.2.1 placeholder-removal fix:

```sh
grep -n -F 'stops attempting to write placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Expect one match per file. `grep` also succeeds when only one file matches, so
its exit status alone does not establish parity; investigate missing or
duplicate entries. Read the complete entry, including continuation paragraphs,
in each file and compare behavior, conditions, examples and links, not just the
title. Other releases may discuss the same feature without describing the same
change.

Then compare the complete files, without changing either one:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean byte-for-byte equality. Status 1 reports
differences (`-` lines are root, `+` lines are site); read each hunk in context,
including site-only changes, before deciding what belongs in the root source.
A status greater than 1 is an error, such as a missing file, not a successful
comparison. Matching copies do not prove a claim is correct; check the
implementation when needed.

### Compare related historical entries

Find the affected release and subsection in both files and compare the
corresponding historical entries in full. Also review related entries in other
releases for consistency, without erasing the difference between historical and
current behavior. For example, **0.1.0 → AI recommendation layer**
(`stack apply [recipe-id]`) describes the original attempt to write placeholder
secrets, and **0.2.1 → Bug fixes** (`stack apply` stops attempting to write
placeholder secrets) describes its removal. Both entries should read the same in
each copy.

## The `stack apply` entries

The current entry sits in both copies as the first bullet under
**Unreleased → Changed**:

> `stack apply` does not create placeholder secrets. After at least one
> provider succeeds, wiring checks secret names for every provider in the
> recipe ...

Confirm it exists once in each file:

```sh
grep -n -F '`stack apply` does not create placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Older `stack apply` entries (0.3.0, 0.2.2, 0.2.1, 0.1.0) are mirrored the same
way.

### The 0.2.1 apply fix

The shared fix is in **0.2.1 (2026-10-16) → Bug fixes**: "`stack apply` stops
attempting to write placeholder secrets." Find it with the first `grep` under
[Review before syncing](#review-before-syncing). When reviewing it:

- [ ] Read the entire bullet in each file and compare meaning and
  qualifications: wiring does not write placeholders or fill missing values,
  provider setup may store real values, and required missing values need user
  action through Phantom. Check the readable and unreadable vault cases, the
  historical failed attempts and the result fields. Resolve a difference
  against the implementation before updating the root copy.
- [ ] Keep the review scoped: agreement on this entry does not establish that
  unrelated entries or the complete files match. Other apply notes in
  Unreleased and 0.3.0 are separate context, not this fix.
