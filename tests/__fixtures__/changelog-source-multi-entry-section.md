# Changelog

## Unreleased

### Fixed

- Fleet JSONL reads (`stack fleet` diagnostics) now enforce the byte cap while reading: a non-tail read grows one buffer up to the cap, probes a single extra byte to detect an oversized or growing source, and rejects an invalid cap (negative or non-integer) instead of reading the whole file first (#360).
- The release workflow renders the Homebrew formula placeholders (`$VERSION$` and the per-platform `$SHA_*$` values) as literals through `sed`, so the generated formula no longer depends on shell quoting of the `$` delimiters (#354).
- The MCP Registry workflow runs only for stable releases or a manual dispatch on an exact tag, checks that the release is complete and reconciles registry state before publishing once (`scripts/mcp-registry-gate.mjs`). Release evidence uses unauthenticated API reads, so a rate limit or outage fails closed; retry the exact-tag dispatch (#363).
