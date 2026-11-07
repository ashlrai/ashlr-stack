# Changelog

## Unreleased

### Fixed

- Fleet JSONL reads (`stack fleet` diagnostics) now enforce the byte cap while reading: a non-tail read grows one buffer up to the cap, probes a single extra byte to detect an oversized or growing source, and rejects an invalid cap (negative or non-integer) instead of reading the whole file first (#360).
