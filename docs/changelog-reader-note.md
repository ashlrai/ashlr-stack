# Reading the changelog

The repository's release notes are in [CHANGELOG.md](../CHANGELOG.md). The
site renders the checked-in [site changelog](../packages/site/src/data/CHANGELOG.md)
at `/docs/changelog`; its content sync copies the root file to that location.
See the [sync procedure](changelog-site-sync.md) before updating either copy.

Entries describe behavior at their recorded point in time. Read the release
heading and the complete entry, including any later annotations, then check
newer entries for changes. `Unreleased` describes work recorded for a future
release and does not establish that it is available in a published version.

For example, the [0.1.0 entry](../CHANGELOG.md#010--2026-04-19-superseded-by-011)
describes historical `stack apply` wiring attempts to write placeholder values;
those calls failed. The [0.2.1 fix](../CHANGELOG.md#021-2026-10-16) removed
the attempts. The original entry includes a later annotation explaining the
change, so read it in full rather than treating the historical behavior as
current. The same entries appear in the [site copy](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011)
and its [0.2.1 section](../packages/site/src/data/CHANGELOG.md#021-2026-10-16).

Changelog files describe the repository's recorded history; they do not prove
which version is installed or deployed. Check the installed version and its
command help or other appropriate deployment evidence before relying on a
behavior.
