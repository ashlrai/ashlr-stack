# Site changelog source map

[CHANGELOG.md](../CHANGELOG.md) is the repository changelog; the site renders
[packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md)
at `/docs/changelog`. The site's `sync-content` script copies the root file over
the site copy before site development and builds, so the two checked-in files
are byte-for-byte identical. This page maps each `stack apply` entry to the
same release and subsection in both files, so a reader can open the entry in
either copy. Entries that only mention `stack apply` while recording a change
to another surface are listed separately below so they are not mistaken for
apply releases.

## Apply entries

Each row gives the release and subsection holding the entry, the text the entry
begins with, and a link to that release in each file. Because the copies match
byte for byte, each pair of links lands on the same section.

| Release → subsection | Entry begins | Root changelog | Site copy |
| --- | --- | --- | --- |
| Unreleased → Changed | "`stack apply` does not create placeholder secrets." — after at least one provider succeeds, wiring checks secret names for every provider in the recipe, including providers that failed, and can create webhook stubs even if the vault is unreadable; `--noWire` skips both. | [section](../CHANGELOG.md#unreleased) | [section](../packages/site/src/data/CHANGELOG.md#unreleased) |
| 0.3.0 (2026-10-31) → Changed and fixed | "Apply wiring checks existing secret names without storing placeholders; unreadable vaults are reported as skipped, not missing." | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.3.0 (2026-10-31) → Changed | "After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names without creating placeholders or filling missing values." — the long entry with the `secrets in vault` / `missing` / `skipped` output examples. | [section](../CHANGELOG.md#030-2026-10-31) | [section](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) |
| 0.2.2 (2026-10-25) → Bug fixes | "**`stack apply` with a missing recipe writes nothing.**" — the recipe is resolved before `stack init` would run. | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.2 (2026-10-25) → Bug fixes | "**`stack apply` and `stack init --template` keep going after a provider fails.**" — every provider is tried and the run ends with `Some providers failed: ...` and exit 1. | [section](../CHANGELOG.md#022-2026-10-25) | [section](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) |
| 0.2.1 (2026-10-16) → Bug fixes | "**`stack apply` stops attempting to write placeholder secrets.**" — the pinned removal entry checked by `packages/site/tests/changelog.test.ts`. 0.2.1 was tagged but never published, so the fix first shipped in 0.2.2. | [section](../CHANGELOG.md#021-2026-10-16) | [section](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) |
| 0.1.0 — 2026-04-19 (superseded by 0.1.1) → AI recommendation layer | "**`stack apply [recipe-id]`**" — the original description of apply and its wiring, still annotated with the failed `TODO_STACK_APPLY` placeholder history. | [section](../CHANGELOG.md#010--2026-04-19-superseded-by-011) | [section](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) |

## Nearby mentions, not apply entries

These bullets spell `stack apply`, or something close to it, but record a
change to another surface:

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

## Verify the map

From the repository root, list every bullet that names `stack apply` in both
files:

```sh
grep -n -E '^- .*`stack apply' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Expect the same line numbers for each file: one hit per mapped entry that
spells `stack apply` verbatim, plus the two mention bullets that also spell it
verbatim (the Bun 1.2 pipe fix and the "`stack recommend [query]`" follow-up).
Then compare the two complete files:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files are identical; status 1 shows
differences, and a higher status is an error such as a missing file. Review any
difference in context before syncing, because `sync-content` overwrites the
site copy. The pinned checks run with:

```sh
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts
```

These check repository files, not a deployed site. For the placeholder-secret
history behind several of these entries, see the
[site changelog placeholder timeline](site-changelog-placeholder-timeline.md),
and for the removal entry specifically see
[where to find the site changelog entry](site-changelog-entry-location.md).
