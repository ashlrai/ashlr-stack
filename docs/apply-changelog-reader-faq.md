# Reader FAQ: the `stack apply` changelog entries

Short answers about what `stack apply` changed and where the change is
recorded, for a reader of the two checked-in changelogs: the repository
[CHANGELOG.md](../CHANGELOG.md) and the site copy
[packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md),
which the site renders at `/docs/changelog`. These answers describe the
checked-in files, not an installed version or a deployed site; compare
`stack apply --help` for the version in use.

## What changed?

`stack apply`'s wiring step stopped attempting to write placeholder secrets
to the Phantom vault and instead checks declared secret names. The fix is
recorded as the first bullet under the first **Bug fixes** heading of
**0.2.1 (2026-10-16)**, titled **`stack apply` stops attempting to write
placeholder secrets.**

Per that entry, wiring previously ran `phantom add <KEY> TODO_STACK_APPLY
--rotate` (then without `--rotate`) for every declared secret. Phantom
Secrets refuses values in argv and has no `--rotate`, so every call failed
and the printed `envelopes` count was always 0; `WireResult.envelopes` is
replaced by `present` and `missing`. The wiring step never writes to the
vault or fills in missing values: each required missing value needs user
action — run `phantom add <NAME>` from a trusted terminal and enter the real
value — and provider setup may separately store real values.

With a readable vault, wiring checks declared names with `phantom list
--json` and prints `secrets in vault N · missing M · webhooks K` plus a
`not in Phantom:` line. With an unreadable vault it reports providers as
skipped instead of identifying missing names.

## Where are the entries found?

The same wording appears in both files. In each:

- [Unreleased → Changed](../CHANGELOG.md#unreleased) ([site copy](../packages/site/src/data/CHANGELOG.md#unreleased)) — current wiring behavior: after at least one provider succeeds, names are checked for every recipe provider including failed ones; a missing name does not itself fail apply, while provider failures do; `--noWire` skips both checks and stubs.
- [0.3.0 (2026-10-31)](../CHANGELOG.md#030-2026-10-31) ([site copy](../packages/site/src/data/CHANGELOG.md#030-2026-10-31)) — the summary under **Changed and fixed** plus the detailed **Changed** entry with readable- and unreadable-vault output examples.
- [0.2.2 (2026-10-25)](../CHANGELOG.md#022-2026-10-25) ([site copy](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)) — related `stack apply` fixes under **Bug fixes**: a missing recipe writes nothing, and `stack apply` and `stack init --template` keep going after a provider fails. Not the placeholder change itself.
- [0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16) ([site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)) — the fix, first bullet under the first **Bug fixes** heading. The release has a second **Bug fixes** heading under "Earlier 0.2.1 notes (2026-10-12)", so the release anchor, not the subsection name, is the stable link target.
- [0.1.0 — 2026-04-19 (superseded by 0.1.1)](../CHANGELOG.md#010--2026-04-19-superseded-by-011) ([site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011)) — the original `stack apply [recipe-id]` description under **AI recommendation layer**, annotated with the failed placeholder history and a pointer to the 0.2.1 fix.

Nearby mentions that are not `stack apply` changes — `stack upgrade
--apply`, `stack doctor --ecosystem --apply`, the `stack_apply` MCP `cwd`
parameter and `stack templates apply` — are mapped in the
[site changelog source map](site-changelog-review.md#apply-entry-source-map).

## Do the two changelogs differ?

Not in this checkout: the files are byte-for-byte identical, so each entry
has the same location, wording, punctuation and issue reference in both.
They differ in role, not content:

- `CHANGELOG.md` is the repository changelog and the source of truth for
  release notes.
- `packages/site/src/data/CHANGELOG.md` is the copy the site renders. The
  site's `sync-content` script overwrites it with the root file before site
  development and builds, so a site-only edit would be overwritten by the
  next sync.

Verify rather than assume, because a difference can appear between syncs.
From the repository root:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean they match. Status 1 prints the
differences (`-` lines are from the root changelog, `+` lines from the site
copy); a higher status is an error such as a missing file, not a successful
comparison.

## Which release shipped the fix?

No release labelled 0.2.1 reached npm: the changelog says it was tagged but
its publish failed, and 0.2.2 supersedes it, shipping everything under both
headings. The fix therefore first shipped in 0.2.2; the 0.3.0 and
Unreleased entries clarify the behavior.

## What do the entries not establish?

- A missing name alone does not fail apply; provider failures do, so a successful apply is not proof that every required secret is present.
- The counts describe checked names. With an unreadable vault — or an unknown provider — providers are reported as skipped and the zero counts do not show the vault is empty or complete.
- Wiring can create webhook stubs even if the vault is unreadable; the entries describe stubs, not finished handlers.
- The files do not record which version is installed or deployed.

## How do I verify these answers?

```sh
grep -n -F 'stops attempting to write placeholder secrets.' \
  CHANGELOG.md packages/site/src/data/CHANGELOG.md
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts
```

Expect exactly one `grep` hit in each file, inside 0.2.1 → Bug fixes; no
`diff` output; and the site tests to pass, including their byte-equality
check. For a prose walkthrough see the [reader guide](apply-changelog-reader-guide.md#reading-the-report);
for the entry table see the [exact locations](apply-changelog-reader-guide.md#exact-locations);
for the entry-level wording comparison see the [comparison](apply-changelog-comparison.md#the-021-fix-entry);
for version-by-version reading see the [release-by-release table](apply-changelog-reader-guide.md#release-by-release)
and the [glossary](apply-changelog-reader-guide.md#glossary).
