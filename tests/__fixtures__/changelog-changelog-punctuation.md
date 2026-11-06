# Changelog

## Unreleased

### Changed

- `stack apply` does not create placeholder secrets; wiring checks secret names for every provider; a missing name does not fail apply; `--noWire` skips both checks.

### Fixed

- Fleet JSONL reads (`stack fleet` diagnostics) now enforce the byte cap while reading: a non-tail read grows one buffer up to the cap, probes a single extra byte to detect an oversized source, and rejects an invalid cap (negative or non-integer) instead of reading the whole file first (#100).

## 0.3.0 (2026-10-31)

### Added

- Fleet diagnostics: lanes, supply, latency, lag, waste, reds, silent jobs, collisions, delivery lag, stuck jobs, SLOs, activity, stream, graph and bets, with grouped `stack fleet` routes.

### Fixed

- The release workflow renders the Homebrew formula placeholders (`$VERSION$` and the per-platform `$SHA_*$` values) as literals through `sed`, so the generated formula no longer depends on shell quoting of the `$` delimiters (#200).
- Multiple issue references: resolved (#300, #301) and closed (#302).

### Documentation

- Setup, README and package READMEs separate the source version from the recorded npm publication (0.3.1 for `@ashlr/stack-core`, `@ashlr/stack` and `ashlr-stack-mcp`) and state that the published CLI declares Node.js 20 or newer.
