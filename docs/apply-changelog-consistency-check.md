# Apply changelog consistency check

The checked-in [root changelog](../CHANGELOG.md) and [site data copy](../packages/site/src/data/CHANGELOG.md) match byte for byte. There are no substantive differences between their `stack apply` entries. This comparison covers the files in this checkout, not a deployed site or an installed release.

| Section in both files | Apply-related content |
| --- | --- |
| Unreleased → Changed | Wiring includes failed recipe providers after at least one success; missing names alone do not fail apply, and `--noWire` skips checks and stubs. |
| 0.3.0 → Changed and fixed / Changed | Wiring checks names without placeholders, distinguishes provider setup, and reports unreadable vaults as skipped. The longer entry includes readable and unreadable output examples and the limits of zero counts. |
| 0.2.2 → Bug fixes | Missing recipes are resolved before initialization; provider failures no longer prevent later providers from being tried. |
| 0.2.1 → Bug fixes | The placeholder-removal fix describes the old failed attempts, the name inventory and the replacement result fields. |
| 0.1.0 → AI recommendation layer | The recipe command, webhook stubs, opt-out and MCP surface are described, with the later placeholder fix incorporated. |

Other mentions concern related surfaces such as piped output, MCP project targeting, and the site's demonstration. Equality of the entire files covers those mentions too. Different release sections provide context at different levels of detail; they are not differences between the two copies.

To repeat the comparison from the repository root before synchronizing site content:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output with exit status 0 means the files match; status 1 shows differences and a higher status indicates an error. Inspect differences in context before changing either file. Site build and development scripts copy the root changelog over the site data, so running them first can hide an existing difference. The [mirroring guide](changelog-mirroring.md#the-021-apply-fix) provides a focused check of the 0.2.1 fix.

## Where the 0.2.1 fix appears

The placeholder-secret wiring fix appears in both checked-in changelogs:

- [Repository changelog: 0.2.1 (2026-10-16)](../CHANGELOG.md#021-2026-10-16)
- [Site changelog data: 0.2.1 (2026-10-16)](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)

In each, the entry is the first bullet under the first **Bug fixes** heading,
starting “`stack apply` stops attempting to write placeholder secrets.” The
links lead to the release heading because the section heading is repeated.

Both entries describe the same change: apply wiring stopped attempting to
write placeholder secrets and instead checks existing secret names without
filling missing values. Earlier placeholder-add attempts failed. Provider setup
may separately store real values; if the vault is unreadable, wiring reports
providers as skipped rather than identifying missing names.

These references describe the checked-in changelogs, not an installed or
deployed version.
