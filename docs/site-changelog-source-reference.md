# Site changelog source reference

The [root changelog](../CHANGELOG.md#021-2026-10-16) and the
[site data copy](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)
each record the `stack apply` placeholder-secret change in **0.2.1
(2026-10-16) → Bug fixes**, as the first bullet: **`stack apply` stops
attempting to write placeholder secrets.** The fix removed attempts that had
failed; wiring checks secret names without writing or filling values. Provider
setup can store real values separately, and users must supply required missing
values through Phantom. If the vault is unreadable, wiring reports providers
as skipped instead of identifying missing names.

The two complete files are currently byte-for-byte identical, so there are no
wording differences between their copies of the entry. The later **0.3.0 →
Changed** and **Unreleased → Changed** notes describe the same behavior with
different detail: the Unreleased note specifies that, after at least one
provider succeeds, wiring checks all recipe providers, can create webhook stubs
even with an unreadable vault, and is skipped entirely with `--noWire`. These
are differences between historical sections, not between the two files.

The root file is the source for the site: `bun run --cwd packages/site
sync-content` copies it to the site data path before site development and builds,
and `/docs/changelog` renders that copy. Compare files before syncing, since
syncing overwrites the site copy:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean they match; status 1 shows differences, and a
higher status indicates an error. Review any differences in context and verify
behavior before updating the source and syncing. The checked-in files do not by
themselves establish what is deployed. For the wider history, see the
[placeholder timeline](changelog-placeholder-timeline.md).
