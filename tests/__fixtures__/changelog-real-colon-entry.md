# Changelog

## 0.3.0 (2026-10-31)

### Added

- Fleet diagnostics: lanes, supply, latency, lag, waste, reds, silent jobs, collisions, delivery lag, stuck jobs, SLOs, activity, stream, graph and bets, with grouped `stack fleet` routes. These inspect existing operational data; they do not establish automatic repair or fleet deployment.
- `stack doctor --repos` reports default-branch CI and open PR counts through gh. Only --json may be combined with this mode.
