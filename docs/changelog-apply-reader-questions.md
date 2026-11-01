# Reader questions: `stack apply` in the changelogs

Answers for a reader comparing how the two checked-in changelogs record the
`stack apply` behavior change: the repository [CHANGELOG.md](../CHANGELOG.md)
and the site copy
[packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md),
which the site renders at `/docs/changelog`. The checked-in files describe
repository content; they do not establish which version is installed or
deployed.

## Which `stack apply` change do these answers cover?

The removal of placeholder-secret writes from apply wiring. Each source
records it as the first bullet under **0.2.1 (2026-10-16) → Bug fixes**, titled
**`stack apply` stops attempting to write placeholder secrets.** Open it at
[0.2.1 in the repository changelog](../CHANGELOG.md#021-2026-10-16) or
[0.2.1 in the site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16).
The release contains a second `Bug fixes` heading under "Earlier 0.2.1 notes
(2026-10-12)", so the release anchor, not the subsection name, is the stable
link target.

## What does the entry say changed?

Wiring never writes to the vault or fills in missing values; provider setup
may separately store real values. With a readable vault, wiring checks
declared names with `phantom list --json` and prints `secrets in vault N ·
missing M · webhooks K` plus a `not in Phantom:` line; with an unreadable
vault it reports providers as skipped instead of identifying missing names.
Each required missing value needs user action: run `phantom add <NAME>` in a
trusted terminal and enter the real value. Previously, wiring ran
`phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`) for
every declared secret; Phantom Secrets refuses values in argv and has no
`--rotate`, so every call failed and the printed `envelopes` count was always
0. `WireResult.envelopes` is replaced by `present` and `missing`.

## What are the differences between the two sources?

In the checked-in files, none: they are byte-for-byte identical, so the entry
has the same location, wording, punctuation and issue reference in each. The
differences are in role, not content:

- `CHANGELOG.md` is the repository changelog and the source of truth for
  release notes.
- `packages/site/src/data/CHANGELOG.md` is the copy the site renders. The
  site's `sync-content` script overwrites it with the root file before site
  development and builds, so a site-only edit would be overwritten by the next
  sync.

Verify parity rather than assuming it, because a difference can appear
between syncs:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files match. Status 1 prints the
differences (`-` lines are from the root changelog, `+` lines from the site
copy); a higher status is an error such as a missing file, not a successful
comparison.

## Where else does each source describe this behavior?

The same change is restated, identically in both files, in four more places:

- **Unreleased → Changed** — "`stack apply` does not create placeholder
  secrets." After at least one provider succeeds, wiring checks names for
  every provider in the recipe, including providers that failed; a missing
  name does not itself fail apply; `--noWire` skips both checks and stubs.
- **0.3.0 (2026-10-31) → Changed and fixed** — "Apply wiring checks existing
  secret names without storing placeholders; unreadable vaults are reported as
  skipped, not missing."
- **0.3.0 (2026-10-31) → Changed** — the long entry with the `secrets in
  vault` and `phantom-wire skipped` output examples.
- **0.1.0 → AI recommendation layer** — the original `stack apply
  [recipe-id]` description, annotated with the failed placeholder history and
  a pointer to the 0.2.1 fix.

`stack apply` itself changed in two other fixes under **0.2.2 → Bug fixes**:
a missing recipe writes nothing, and a failed provider no longer stops the
remaining providers. Nearby mentions that are not `stack apply` changes —
`stack upgrade --apply`, `stack doctor --ecosystem --apply`, the `stack_apply`
MCP `cwd` parameter and `stack templates apply` — are mapped in the
[site changelog source map](site-changelog-source-map.md).

## Which release shipped the change?

No release labelled 0.2.1: it was tagged but its npm publish failed, and
0.2.2 (2026-10-25) supersedes it, shipping everything under both headings. The
fix therefore first shipped in 0.2.2; the 0.3.0 and Unreleased entries clarify
the behavior. Compare the installed version and `stack apply --help` before
relying on this description.

## How do I check these answers myself?

From the repository root:

```sh
grep -n -F 'stops attempting to write placeholder secrets.' \
  CHANGELOG.md packages/site/src/data/CHANGELOG.md
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts
```

Expect exactly one `grep` hit in each file, inside 0.2.1 → Bug fixes; no
`diff` output; and the site tests to pass, including their byte-equality
check. For a prose walkthrough of the fix see the
[reader guide](changelog-apply-reader-guide.md), for the entry-level wording
comparison see the [comparison](changelog-apply-comparison.md), and for its
exact position in each file see the
[apply source map](changelog-apply-source-map.md).
