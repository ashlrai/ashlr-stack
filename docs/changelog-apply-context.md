# Context: the `stack apply` placeholder entries in the changelogs

The two checked-in changelogs — the repository
[CHANGELOG.md](../CHANGELOG.md) and the site copy
[packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md) —
describe `stack apply` writing placeholder secrets. That behavior is
historical: the writes always failed, they were removed, and they do not
happen today. This note explains why the historical wording is present and
points to both entries that record it.

## Why placeholder writes appear at all

Early `stack apply` wiring tried to store a `TODO_STACK_APPLY` placeholder for
each declared secret. For every declared name it ran `phantom add <KEY>
TODO_STACK_APPLY --rotate`, then retried without `--rotate`. Phantom Secrets
refuses secret values in command arguments and has no `--rotate` flag, so
every call failed, no placeholder was ever stored, and the reported
`envelopes` count was always zero. The 0.2.1 fix removed the attempts and
replaced `WireResult.envelopes` with `present` and `missing`. These commands
are recorded to document the change; do not run them, and do not add
placeholder values yourself — a placeholder is not a credential and can block
a real value under the same name.

## The two entries

| Entry | What it records | Repository changelog | Site changelog data |
| --- | --- | --- | --- |
| `0.2.1 (2026-10-16)` → `Bug fixes` | The removal: **`stack apply` stops attempting to write placeholder secrets.** | [source](../CHANGELOG.md#021-2026-10-16) | [site copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) |
| `0.1.0` → `stack apply [recipe-id]` | The original feature entry, annotated that placeholder writes were attempted historically and failed. | [source](../CHANGELOG.md#010--2026-04-19-superseded-by-011) | [site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) |

`Bug fixes` occurs more than once in each file, including twice within 0.2.1,
so the links target the release headings rather than the subsection. The site
data file is a synchronized copy of the root changelog — the site's
`sync-content` script rewrites it before site development and builds — and the
checked-in files are byte-for-byte identical. Verify parity rather than
assuming it, since a difference can appear between syncs:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
grep -n -F 'TODO_STACK_APPLY' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Expect no `diff` output and two `grep` matches per file, one inside each of
the two entries.

## What the entries mean today

0.2.1 was tagged but never reached npm; the removal first shipped in 0.2.2,
and the 0.3.0 and Unreleased entries restate the current behavior. Wiring now
only reads: after at least one provider succeeds, it checks the recipe's
declared secret names against `phantom list --json`, reports
`secrets in vault N · missing M · webhooks K`, and never writes to the vault
or fills missing values. When the vault is unreadable, providers are reported
as skipped rather than identified as missing. Missing names alone do not fail
apply; provider failures still do. Supply each required missing value by
running `phantom add <NAME>` in a trusted terminal and entering the real
value; `--noWire` skips both the name checks and the webhook stubs. Release
notes describe source history — compare the installed version and
`stack apply --help` before relying on this description.

## Related notes

- [Placeholder history](apply-placeholder-history.md) — the failed attempts,
  their removal, and current wiring behavior.
- [Apply changelog comparison](changelog-apply-comparison.md) — wording of the
  0.2.1 fix entry in both files.
- [Apply source map](changelog-apply-source-map.md) — the fix entry's exact
  position in each changelog.
- [Reader questions](changelog-apply-reader-questions.md) — answers across
  both checked-in changelogs.
- [Placeholder timeline](changelog-placeholder-timeline.md) — the record
  release by release.
