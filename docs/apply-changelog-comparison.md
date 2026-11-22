# `stack apply` changelog comparison

This compares the checked-in [root changelog](../CHANGELOG.md) with the
[site changelog data](../packages/site/src/data/CHANGELOG.md). The corresponding
entries below have **no wording differences**: their text, punctuation and
Markdown match. The complete files are also byte-for-byte identical in this
checkout. This is a source comparison, not evidence of what is installed or
published.

| Location in both files | Corresponding entry and emphasis |
| --- | --- |
| [Unreleased → Changed](../CHANGELOG.md#unreleased) ([site](../packages/site/src/data/CHANGELOG.md#unreleased)) | `stack apply` does not create placeholder secrets. After a provider succeeds, wiring checks all recipe providers, including failures; missing names alone do not fail apply. Webhook stubs can be created even if the vault is unreadable; `--noWire` skips both operations. |
| [0.3.0 → Changed and fixed](../CHANGELOG.md#030-2026-10-31) ([site](../packages/site/src/data/CHANGELOG.md#030-2026-10-31)) | The short apply-wiring summary distinguishes skipped unreadable vaults from missing names and notes that provider setup may store real credentials. |
| [0.3.0 → Changed](../CHANGELOG.md#030-2026-10-31) ([site](../packages/site/src/data/CHANGELOG.md#030-2026-10-31)) | The longer apply note explains required values, readable and unreadable vault output, skipped unknown providers, and `--noWire`. Its examples caution that zero checked counts do not prove the vault is empty. |
| [0.2.2 → Agent-facing output](../CHANGELOG.md#022-2026-10-25) ([site](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)) | The Bun pipe-output fix includes the final line of a failing `stack apply` as an example. |
| [0.2.2 → Bug fixes](../CHANGELOG.md#022-2026-10-25) ([site](../packages/site/src/data/CHANGELOG.md#022-2026-10-25)) | Two entries cover resolving a missing recipe before initialization and continuing through provider failures with a failure summary and exit 1. |
| [0.2.1 → Bug fixes](../CHANGELOG.md#021-2026-10-16) ([site](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)) | The placeholder fix says wiring does not write to the vault, describes the failed earlier attempts, and replaces `WireResult.envelopes` with `present` and `missing`. Provider setup may separately store real values. |
| [0.2.1 → Hero “Generate a stack” demo](../CHANGELOG.md#021-2026-10-16) ([site](../packages/site/src/data/CHANGELOG.md#021-2026-10-16)) | The site demo depicts a recommend-to-apply loop. |
| [0.1.0 → AI recommendation layer](../CHANGELOG.md#010--2026-04-19-superseded-by-011) ([site](../packages/site/src/data/CHANGELOG.md#010--2026-04-19-superseded-by-011)) | The recommend, apply and MCP bullets describe saved recipes, apply wiring and `stack_apply`. The apply bullet incorporates the later placeholder fix; it is not a verbatim record of the original release behavior. |

The entries within each file describe different releases and aspects of apply;
differences in their emphasis are not differences between the two copies.
Other commands' `--apply` flags are outside this comparison.

## Placeholder-wiring language

**There are no wording or substantive differences between the two copies** of
the `stack apply` placeholder-wiring change. The sections that describe it
differ only in scope:

| Location in each file | Wording and scope |
| --- | --- |
| Unreleased → Changed | Says apply creates no placeholder secrets; after at least one provider succeeds, wiring checks all recipe providers, including failed ones. Missing names alone do not fail apply; provider failures do. Webhook stubs can be created even with an unreadable vault, and `--noWire` skips checks and stubs. |
| 0.3.0 → Changed and fixed | Summarizes the name check, skipped unreadable vaults, and the separate possibility of provider setup storing real credentials. |
| 0.3.0 → Changed | Explains missing-name reporting, the trusted-terminal `phantom add <NAME>` action, unreadable vault and unknown-provider skips, example output, and why zero checked counts do not prove the vault is empty. |
| 0.2.1 → Bug fixes | Describes the fix: wiring no longer writes to the vault or fills missing values. The former placeholder-add attempts failed, and `WireResult.envelopes` was replaced by `present` and `missing`. |
| 0.1.0 → AI recommendation layer | Describes apply and webhook wiring, with the later placeholder fix incorporated and missing names distinguished from provider failures. |

Wiring's name checks do not prevent provider setup from separately storing real
credentials. Missing required values still need user action through Phantom.

## The 0.2.1 fix entry

In each file, the fix is the first bullet under **Bug fixes** in 0.2.1
(2026-10-16), beginning “`stack apply` stops attempting to write placeholder
secrets.” The 0.2.1 links in the first table point to that release heading.

**Substantive wording differences: none.** The complete entry is identical in
both checked-in sources, including its commands, result fields and historical
explanation. Both distinguish wiring's name checks from provider setup, which may
store real values; describe supplying required missing values through Phantom;
and say an unreadable vault results in providers being reported as skipped.
Both also describe the failed placeholder-add attempts and the replacement of
`WireResult.envelopes` with `present` and `missing`.

| Topic | What both entries say |
| --- | --- |
| Wiring and setup | Wiring does not write to the vault or fill missing values; provider setup may separately store real values. |
| Required values | Users supply each required missing value through Phantom in a trusted terminal. |
| Readable vault | Wiring checks names with `phantom list --json`, reports present and missing counts and lists missing names. |
| Unreadable vault | Providers are reported as skipped, rather than identified as missing. |
| Previous behavior | Placeholder-add attempts failed; the printed `envelopes` count was always zero. |
| Result fields | `WireResult.envelopes` was replaced by `present` and `missing`. |

The [mirroring guide](changelog-mirroring.md#the-021-apply-fix) describes how to
locate this entry and compare the files.

## Repeat the comparison

Run from the repository root **before** any site content sync:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files match; status 1 shows differences,
and a higher status indicates an error. The site's `sync-content` script copies
the root changelog over the site data during development and builds, so syncing
first can hide a checked-in discrepancy. Inspect any diff in its release context
before updating this document.
