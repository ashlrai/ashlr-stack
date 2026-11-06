# Changelog

## 0.4.0 (2026-11-01)

### Fixed

- The release workflow renders the Homebrew formula placeholders (`$VERSION$` and the per-platform `$SHA_*$` values) as literals through `sed`, so the formula no longer depends on shell quoting (#354).
- The MCP Registry workflow runs only for stable releases (`scripts/mcp-registry-gate.mjs`); `--noWire` skips both checks and stubs.
- Fleet JSONL reads (`stack fleet` diagnostics) reject an invalid cap.
