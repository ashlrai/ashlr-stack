# Changelog

## Unreleased

### Changed

- `stack apply` does not create placeholder secrets. After at least one provider succeeds, wiring checks secret names for every provider in the recipe, including providers that failed; a missing name does not itself fail apply, while provider failures do. Wiring can also create webhook stubs for those recipe providers, even if the vault is unreadable. Supply required missing secrets as real values through Phantom; `--noWire` skips both checks and stubs.

## 0.3.0 (2026-10-31)

### Added

- Fleet diagnostics: lanes, supply, latency, lag, waste, reds, silent jobs, collisions, delivery lag, stuck jobs, SLOs, activity, stream, graph and bets, with grouped `stack fleet` routes. These inspect existing operational data; they do not establish automatic repair or fleet deployment.
- `stack doctor --repos` reports default-branch CI and open PR counts through gh. Only --json may be combined with this mode.
