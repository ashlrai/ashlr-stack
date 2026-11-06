# Changelog format

Release notes live in two byte-identical files:

| Copy | Path | Role |
| --- | --- | --- |
| Root | [`CHANGELOG.md`](../CHANGELOG.md) | Source of truth |
| Site | [`packages/site/src/data/CHANGELOG.md`](../packages/site/src/data/CHANGELOG.md) | Mirror rendered at `/docs/changelog` |

Edit the root file, then re-mirror with `bun run --cwd packages/site sync-content`.
See [changelog-mirroring.md](changelog-mirroring.md) for the procedure.
Everything below describes the format observed in both copies.

## File skeleton

```text
# Changelog
## Unreleased
### Changed
- entry text
## 0.3.0 (2026-10-31)
### Added
- entry text
## 0.2.2 (2026-10-25)
```

`# Changelog` is the only level-1 heading and `## Unreleased` is always the
first level-2 heading; releases follow, newest first.

## Version headings

A release heading is a level-2 heading whose text opens with a three-part
version, optionally wrapped in brackets. The heading check used by the site
tests matches `^\[?(\d+)\.(\d+)\.(\d+)\]?` — version first, decorations after.

The observed shapes, quoted verbatim from both files:

| Shape | Example (present in both files) |
| --- | --- |
| `## <version> (<date>)` | `## 0.3.0 (2026-10-31)` |
| `## <version> (<date>)` | `## 0.2.2 (2026-10-25)` |
| `## <version> (<date>)` | `## 0.2.1 (2026-10-16)` |
| `## [<version>] — <date>` | `## [0.2.0] — 2026-04-23` |
| `## <version> — <date>` | `## 0.1.1 — 2026-04-19` |
| `## <version> — <date> (<note>)` | `## 0.1.0 — 2026-04-19 (superseded by 0.1.1)` |

Two date styles coexist: newer releases put the ISO date in parentheses, while
the earliest releases separate version and date with an em dash and may bracket
the version. A parenthetical suffix after the date carries notes such as
`(superseded by 0.1.1)`. Write new release headings in the
`## <version> (<date>)` style used by 0.2.1 and later.

## Ordering

- `## Unreleased` sits first, immediately under `# Changelog`.
- Releases follow in strictly descending version order — in the files today
  that is `## 0.3.0 (2026-10-31)`, then `## 0.2.2 (2026-10-25)`,
  `## 0.2.1 (2026-10-16)`, `## [0.2.0] — 2026-04-23`, `## 0.1.1 — 2026-04-19`
  and `## 0.1.0 — 2026-04-19 (superseded by 0.1.1)`. New releases go directly
  under `Unreleased`, above every shipped version.
- Each version appears in exactly one heading; superseded versions keep their
  own section and say so in the heading, as 0.1.0 does.
- Heading depth never jumps more than one level: `##` sections contain `###`
  subsections, and no `####` is used.

## Subsections

Two kinds of `###` headings appear inside a release:

- **Category headings** in Keep a Changelog vocabulary — observed: `Added`,
  `Changed`, `Fixed`, `Documentation`, `Compatibility notes`,
  `Changed and fixed`, `Bug fixes`, `Templates`, `Tests`, `Site`, `Docs`,
  `Release process`, `Install fixes`, and similar agent-facing labels.
- **Topic headings** that group a feature area, for example
  `### Earlier 0.2.1 notes (2026-10-12)` under `## 0.2.1 (2026-10-16)`, or
  this heading under `## 0.1.0 — 2026-04-19 (superseded by 0.1.1)`:

  ```text
  ### AI recommendation layer — `stack recommend` + `stack apply`
  ```

There is no fixed subsection list. A release may also open with a prose
paragraph before its first `###` — `## 0.2.2 (2026-10-25)` and
`## 0.1.1 — 2026-04-19` both do — or place bullets directly under the `##`
heading, as `## 0.1.1 — 2026-04-19` does.

## Entries

- Entries are `- ` bullets. Some lead with a bold label — under
  `## 0.1.0 — 2026-04-19 (superseded by 0.1.1)` one entry opens with
  `` - **`stack apply [recipe-id]`** ``.
- Long entries continue in indented paragraphs and fenced example blocks — the
  `### Changed` section under `## 0.3.0 (2026-10-31)` embeds `text` fences
  showing wiring output.
- Issue references trail entries in parentheses, e.g. `(#360)` under
  `## Unreleased` → `### Fixed`.

## Rules enforced by tests

`packages/site/tests/changelog.test.ts`,
`packages/site/tests/changelog-empty-sections.test.ts` and the `scripts/`
suite pin this format:

- exactly one `#` heading, `Changelog`;
- the first `##` is `Unreleased`;
- every other `##` begins with an optionally bracketed `X.Y.Z` version;
- release versions strictly decrease down the file, each version listed once;
- every version heading is followed by non-whitespace content before the next
  version heading or the end of the file — no empty release sections;
- heading depth never increases by more than one level;
- the site copy equals the root copy byte for byte.

Run the checks:

```sh
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts packages/site/tests/changelog-empty-sections.test.ts scripts/changelog-version-headings.test.ts scripts/changelog-mirroring.test.ts scripts/changelog-format.test.ts
```
