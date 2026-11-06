# Changelog

## Unreleased

### Fixed

- Pending fix for `stack doctor --repos`.

## 0.3.0 (2026-10-31)

### Added

- `stack doctor --repos` reports CI state; set `GH_TOKEN` first.

### Changed

- Use `stack apply` with `--noWire` to skip stubs.
  - Nested: `STACK_MANIFEST` is read-only.

## 0.2.0 (2026-05-01)

### Added

- `stack doctor --repos` does not exist yet; try `stack scan`.
