# Changelog

## Unreleased

### Fixed

- Fleet reads (`stack fleet`) enforce the byte cap: a non-tail read grows one buffer, probes one extra byte, and rejects an invalid cap (negative, non-integer, or NaN) (#360).
- **Wiring, checks: two things** — names (a, b, c): kept; nested (inner (deeper)), done.
