# Changelog

## 0.4.0 (2026-11-01)

- The release workflow renders the Homebrew formula placeholders (`$VERSION$` and the per-platform `$SHA_*$` values) as literals through `sed` (#354).
- A timeout is now visible: human output shows `(timed out after 2s)`, and `--json` adds `secret_count_error: "timeout"` or `"error"`.
- Wiring output reads ``(not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)`` in one span.

## 0.3.0 (2026-10-01)

- Plain entry with no code.
