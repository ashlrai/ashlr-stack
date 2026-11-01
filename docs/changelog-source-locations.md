# Changelog source locations

The repository's release notes are in [CHANGELOG.md](../CHANGELOG.md). The
site renders [packages/site/src/data/CHANGELOG.md](../packages/site/src/data/CHANGELOG.md)
at `/docs/changelog`. The site's `sync-content` script copies the root file
over the site copy for development and builds. Compare the files before
syncing: a site-only edit would be overwritten. See the
[sync procedure](changelog-site-sync.md) for review and verification steps.

## Finding `stack apply` entries

From the repository root, search both files for the literal command:

```sh
rg -n -F 'stack apply' CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

Read each match under its surrounding release and subsection; some matches
describe another feature that merely mentions the command. A search for the
literal command also misses descriptions that say only “Apply wiring”. Use
these starting points in either copy:

| Release and subsection | What to look for |
| --- | --- |
| [Unreleased](../CHANGELOG.md#unreleased) / [site](../packages/site/src/data/CHANGELOG.md#unreleased) → Changed | `stack apply` does not create placeholder secrets. |
| [0.3.0](../CHANGELOG.md#030-2026-10-31) / [site](../packages/site/src/data/CHANGELOG.md#030-2026-10-31) → Changed and fixed, then Changed | Apply wiring checks existing secret names; the longer entry explains the conditions and output. |
| [0.2.2](../CHANGELOG.md#022-2026-10-25) / [site](../packages/site/src/data/CHANGELOG.md#022-2026-10-25) → Bug fixes | Missing recipes write nothing; provider failures do not stop later providers. |
| [0.2.1](../CHANGELOG.md#021-2026-10-16) / [site](../packages/site/src/data/CHANGELOG.md#021-2026-10-16) → first Bug fixes | The first bullet describes stopping placeholder-secret attempts. There is another Bug fixes subsection later in this release. |
| [0.1.0](../CHANGELOG.md#010--2026-04-19-superseded-by-011) / [site](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011) → AI recommendation layer | The `stack apply [recipe-id]` bullet describes the original command and annotated wiring history. |

The [detailed source map](site-changelog-source-map.md) distinguishes nearby
mentions and lists each known entry. The
[apply changelog terminology](apply-changelog-terminology.md) defines the terms
the entries use and cites each term's entries. These checked-in files describe
repository content; they do not establish which version is installed or deployed.
