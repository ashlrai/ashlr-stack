# Changelog

## Unreleased

### Entries

- The README now lists the available options for every CLI command and subcommand.
- Installation guides, MCP setup examples and agent references now record published version 0.3.10 and its Node.js 20 minimum, while keeping older verification results clearly dated.

## 0.3.0 (2026-10-31)

### Entries

- Fleet diagnostics: lanes, supply, latency, lag, waste, reds, silent jobs, collisions, delivery lag, stuck jobs, SLOs, activity, stream, graph and bets, with grouped `stack fleet` routes. These inspect existing operational data; they do not establish automatic repair or fleet deployment.
- `stack doctor --repos` reports default-branch CI and open PR counts through gh. Only --json may be combined with this mode.

## [0.2.0] — 2026-04-23

### Entries

- Compiled node-compatible CLI bin (`dist/index.js`); `npm install -g @ashlr/stack` now works without bun on the host.
- `stack init --template` runs the full provisioning pipeline for every template service via a shared `lib/provision-loop.ts` helper; `--noProvision` preserves shape-only behavior.
