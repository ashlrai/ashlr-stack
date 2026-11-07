# Changelog

## Unreleased

### Entries

- `stack apply` does not create placeholder secrets. After at least one provider succeeds, wiring checks secret names for every provider in the recipe, including providers that failed; a missing name does not itself fail apply, while provider failures do. Wiring can also create webhook stubs for those recipe providers, even if the vault is unreadable. Supply required missing secrets as real values through Phantom; `--noWire` skips both checks and stubs.
- Fleet JSONL reads (`stack fleet` diagnostics) now enforce the byte cap while reading: a non-tail read grows one buffer up to the cap, probes a single extra byte to detect an oversized or growing source, and rejects an invalid cap (negative or non-integer) instead of reading the whole file first (#360).

## 0.3.0 (2026-10-31)

### Entries

- Fleet diagnostics: lanes, supply, latency, lag, waste, reds, silent jobs, collisions, delivery lag, stuck jobs, SLOs, activity, stream, graph and bets, with grouped `stack fleet` routes. These inspect existing operational data; they do not establish automatic repair or fleet deployment.
- `stack doctor --repos` reports default-branch CI and open PR counts through gh. Only --json may be combined with this mode.

## [0.2.0] — 2026-04-23

### Entries

- Compiled node-compatible CLI bin (`dist/index.js`); `npm install -g @ashlr/stack` now works without bun on the host.
- `stack init --template` runs the full provisioning pipeline for every template service via a shared `lib/provision-loop.ts` helper; `--noProvision` preserves shape-only behavior.
