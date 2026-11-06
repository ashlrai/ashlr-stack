# Changelog

## Unreleased

### Fixed

- Reads (large, growing files) now stop at the cap: a probe byte, not a full read, detects overflow (#1, #2).
