# Changelog

## 0.5.0 (2026-11-03)

### Added

- Run `stack apply --noWire` to skip wiring; flags like `--json` stay literal.
- Code spans keep markup: `a - b`, `[not a link](x)`, and `## not a heading`.
- Starts with `--flag` immediately at the beginning.
- Ends with `--flag` at the very end.
- Multiple spans: `a`, `b`, and `c` in one line.
