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

To repeat the comparison from the repository root before any site content sync:

```sh
diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
```

No output and exit status 0 mean the files match; status 1 shows differences,
and a higher status indicates an error. Site content synchronization copies the
root changelog over the site data, so syncing first can hide a discrepancy.
