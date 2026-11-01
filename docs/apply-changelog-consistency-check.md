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

No output with exit status 0 means the files match; status 1 shows differences and a higher status indicates an error. Inspect differences in context before changing either file. Site build and development scripts copy the root changelog over the site data, so running them first can hide an existing difference. The [mirror review](changelog-mirror-review.md) provides a focused check of the 0.2.1 fix.
