# Site changelog review

Use this guide when reviewing a change to the [site changelog](../packages/site/src/data/CHANGELOG.md),
including changes copied from the [root changelog](../CHANGELOG.md). The root
file is the source: the site's `sync-content` script copies it over the site
file before development and builds, and `/docs/changelog` renders that copy.
Review the checked-in files before syncing, because syncing overwrites the site
copy and can hide a discrepancy. When a change is needed, correct the root.

The guide also holds the [apply entry source map](#apply-entry-source-map),
which locates every `stack apply` entry in both files, and the
[apply placeholder timeline](#apply-placeholder-timeline).

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
differ, and a higher status indicates an error such as a missing file. Review
any differences in context before updating the root and syncing. This is
separate from deciding whether two entries agree; for the full mirroring
procedure, see [the mirroring guide](changelog-mirroring.md). These checks cover
repository files, not a deployed site. For the wider history, see the
[placeholder timeline](changelog-placeholder-timeline.md).

## Apply entry source map

This map ties each `stack apply` entry to the same release and subsection in
both files, so a reader can open the entry in either copy. Each row gives the
release and subsection holding the entry, the text the entry begins with, and a
link to that release in each file. Because the copies match byte for byte, each
pair of links lands on the same section. Entries that only mention
`stack apply` while recording a change to another surface are listed
separately so they are not mistaken for apply releases.

| Release → subsection | Entry begins | Root changelog | Site copy |
| --- | --- | --- | --- |
| Unreleased → Changed | "`stack apply` does not create placeholder secrets." — after at least one provider succeeds, wiring checks secret names for every provider in the recipe, including providers that failed, and can create webhook stubs even if the vault is unreadable; `--noWire` skips both. | [section](../CHANGELOG.md#unreleased) | [section](../packages/site/src/data/CHANGELOG.md#unreleased) |
| 0.3.0 (2026-10-31) → Changed and fixed | "Apply wiring checks existing secret names without storing placeholders; unreadable vaults are reported as skipped, not missing." | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.3.0 (2026-10-31) → Changed | "After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names without creating placeholders or filling missing values." — the long entry with the `secrets in vault` / `missing` / `skipped` output examples. | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.2.2 (2026-10-25) → Bug fixes | "**`stack apply` with a missing recipe writes nothing.**" — the recipe is resolved before `stack init` would run. | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.2 (2026-10-25) → Bug fixes | "**`stack apply` and `stack init --template` keep going after a provider fails.**" — every provider is tried and the run ends with `Some providers failed: ...` and exit 1. | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.1 (2026-10-16) → Bug fixes | "**`stack apply` stops attempting to write placeholder secrets.**" — the pinned removal entry checked by `packages/site/tests/changelog.test.ts` and covered by the worked example above. 0.2.1 was tagged but never published, so the fix first shipped in 0.2.2. | [section](../CHANGELOG.md#021-2026-10-16) | [section](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) |
| 0.1.0 — 2026-04-19 (superseded by 0.1.1) → AI recommendation layer | "**`stack apply [recipe-id]`**" — the original description of apply and its wiring, still annotated with the failed `TODO_STACK_APPLY` placeholder history. | [section](../CHANGELOG.md#010--2026-04-19-superseded-by-011) | [section](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) |

### Nearby mentions, not apply entries

These bullets spell `stack apply`, or something close to it, but record a
change to another surface:

- **Unreleased → Next release (since v0.3.10) → Fixed:** "The Phantom wire assumptions doc links `" records source line links in documentation and a test that checks them; command behavior is unchanged.
- **Unreleased → Next release (since v0.3.10) → Fixed:** "Wiring guides now use the supported `stack apply --noWire`" records a documentation correction; command behavior is unchanged.
- **0.3.8 → Testing:** "Expanded coverage for `stack apply` when" describes
  test coverage for missing secrets, Phantom, wiring and changelog parsing.
- **0.2.2 → Agent-facing output:** "The last lines of a failing command reach
  a pipe on Bun 1.2." cites a piped `stack apply` as one example of lost
  output, and "An unknown template names where to find the real ones."
  concerns `stack templates apply <name>`, a different command.
- **0.2.1 → Hero "Generate a stack" demo:** the "Clickable in-hero animation
  that plays a realistic `stack recommend → stack apply` loop" bullet is a
  site feature, not an apply change.
- **0.1.0 → AI recommendation layer:** the "`stack recommend [query]`" bullet
  ends with "follow up with `stack apply <id>`", and the "MCP surface" bullet
  lists `stack_apply` among the MCP tools.
- **Flags on other commands and the MCP tool:** `stack upgrade --apply`
  (0.3.0 → Added) and the `--apply <tools>` selection on
  `stack doctor --ecosystem` (0.2.2 → Added, Changed) are flags on `upgrade`
  and `doctor`, not the `stack apply` pipeline. The `stack_apply` MCP tool
  gaining an optional `cwd` (0.2.2 → MCP project targeting) is likewise an
  MCP-surface change.

### Verify the map

From the repository root, list every bullet that names `stack apply` in both
files:

```sh
grep -n -E '^- .*`stack apply' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Expect the same line numbers for each file: one hit per mapped entry that
spells `stack apply` verbatim, plus the five mention bullets that also spell it
verbatim (the next release's wire assumptions doc links, its wiring guide
correction, the 0.3.8 tests, Bun 1.2 pipe fix and "`stack recommend [query]`"
follow-up). Then run the whole-file comparison above and the pinned
`changelog.test.ts` from the checklist. These check repository files, not a
deployed site.

## Apply placeholder timeline

The site changelog's 0.2.1 bug fix records when `stack apply` stopped
**attempting** to write placeholder secrets. These rows trace that history
through the site copy:

| Entry | Recorded change |
| --- | --- |
| [0.1.0](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) | The apply description says wiring historically attempted a `TODO_STACK_APPLY` placeholder for each declared secret. Those calls failed. |
| [0.2.1 (2026-10-16)](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) | The bug fix removed those attempts. Phantom refused values in arguments and did not support `--rotate`; the old `envelopes` count was always zero. `WireResult.envelopes` was replaced by `present` and `missing`. |
| [0.2.2 (2026-10-25)](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) | 0.2.1 was tagged but its npm publish failed. The 0.2.2 entry says it ships the 0.2.1 changes. |
| [0.3.0 (2026-10-31)](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) | Wiring checks existing secret names without filling values. An unreadable vault means providers are reported as skipped, not missing. |
| [Unreleased](../packages/site/src/data/CHANGELOG.md#unreleased) | After at least one provider succeeds, wiring checks every recipe provider, including failed ones, and can create webhook stubs even if the vault is unreadable. |

Wiring does not fill missing values; provider setup may store real credentials
separately. Supply each required missing value with `phantom add <NAME>` in a
trusted terminal. A missing name alone does not fail apply, but provider
failures do. `--noWire` skips the wiring checks and webhook stubs.

For the broader history and related guidance, see the
[placeholder-secret timeline](changelog-placeholder-timeline.md).
