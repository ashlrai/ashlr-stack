# Changelog

## Unreleased

### Fixed

- Fleet JSONL reads (`stack fleet` diagnostics) now enforce the byte cap while reading (#360).

- The release workflow renders the Homebrew formula placeholders (`$VERSION$`) as literals through `sed` (#354).

## 0.3.0 (2026-10-31)

### Added

- Fleet diagnostics: lanes, supply, latency.
