# Changelog

## 0.3.0 (2026-10-31)

### Added

- Added retry logic, with exponential backoff, for unreliable endpoints (see #123).
- New provider for Cloudflare Workers: supports binding, streaming, and observability.

### Fixed

- Fixed timeout handling: connections now close cleanly (fixes #456, closes #457).
- Punctuation in entries: commas, colons (:) and parentheses () are all preserved.

## 0.2.0 (2026-04-23)

### Changed

- Updated configuration format (breaking: migrate your config file).
- Renamed the `stack apply` flag: use `--apply` instead of `--run` (deprecated).

## 0.1.0 (2026-04-19)

- Initial release: core parsing, version detection, and changelog mirroring.
