# Where the `stack apply` wiring change appears in each changelog

The `stack apply` wiring change is that wiring checks secret names and never
writes placeholder values. It is recorded in both checked-in changelogs, the
root [`CHANGELOG.md`](../CHANGELOG.md) and the site copy
[`packages/site/src/data/CHANGELOG.md`](../packages/site/src/data/CHANGELOG.md).
Both files list it under the same release heading, subheading and bullet.

| Release heading | Subheading | Bullet starts with |
| --- | --- | --- |
| `Unreleased` | `Changed` | `stack apply` does not create placeholder secrets. |
| `0.3.0 (2026-10-31)` | `Changed and fixed` | Apply wiring checks existing secret names without storing placeholders; |
| `0.3.0 (2026-10-31)` | `Changed` (second occurrence) | After at least one provider succeeds, `stack apply` wiring checks |
| `0.2.1 (2026-10-16)` | `Bug fixes` | **`stack apply` stops attempting to write placeholder secrets.** |
| `0.1.0 — 2026-04-19 (superseded by 0.1.1)` | `AI recommendation layer` | **`stack apply [recipe-id]`** (annotated with the later change) |

Notes:

- The release headings and subheadings repeat (`Changed` and `Bug fixes` occur
  in several releases), so find an entry by release heading first, then by the
  bullet's opening words.
- The 0.2.1 bullet is the original record of the fix. The other entries restate
  or extend it.
- The two files are expected to match line for line, so an entry sits at the
  same line number in each. `packages/site/tests/changelog.test.ts` guards the
  copy.
- These files do not establish which version is installed or published; the
  0.2.2 note says 0.2.1 was tagged but its npm publish failed.
