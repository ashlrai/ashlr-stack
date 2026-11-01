# Placeholder-wiring changelog language comparison

The [root changelog](../CHANGELOG.md) and the [site changelog data](../packages/site/src/data/CHANGELOG.md) are byte-for-byte identical in this checkout. **There are no wording or substantive differences between the two copies** of the `stack apply` placeholder-wiring change. This compares checked-in files, not a deployed site or an installed release.

| Location in each file | Wording and scope |
| --- | --- |
| Unreleased → Changed | Says apply creates no placeholder secrets; after at least one provider succeeds, wiring checks all recipe providers, including failed ones. Missing names alone do not fail apply; provider failures do. Webhook stubs can be created even with an unreadable vault, and `--noWire` skips checks and stubs. |
| 0.3.0 → Changed and fixed | Summarizes the name check, skipped unreadable vaults, and the separate possibility of provider setup storing real credentials. |
| 0.3.0 → Changed | Explains missing-name reporting, the trusted-terminal `phantom add <NAME>` action, unreadable vault and unknown-provider skips, example output, and why zero checked counts do not prove the vault is empty. |
| 0.2.1 → Bug fixes | Describes the fix: wiring no longer writes to the vault or fills missing values. The former placeholder-add attempts failed, and `WireResult.envelopes` was replaced by `present` and `missing`. |
| 0.1.0 → AI recommendation layer | Describes apply and webhook wiring, with the later placeholder fix incorporated and missing names distinguished from provider failures. |

These sections emphasize different details within each changelog; those differences in emphasis are not discrepancies between the root and site copies. In particular, wiring's name checks do not prevent provider setup from separately storing real credentials. Missing required values still need user action through Phantom.

To repeat the comparison **before** a site sync, run from the repository root:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files match; status 1 indicates differences and a higher status indicates an error. The site's `sync-content` script copies the root changelog over the site data during development and builds, so syncing first can conceal a checked-in difference. Inspect any diff in its release context before updating this document.
