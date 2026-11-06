# Changelog

## 0.3.0 (2026-06-01)

### Fixed

- A literal backtick needs a longer fence: ``stack run`cmd`` keeps the inner backticks.
- A span may wrap a soft line break: `stack
  doctor` stays one span.
- Parent entry with `stack fleet`:
  - nested child keeps `--json` too.
- Markup stays literal in a span: `<b>&amp;</b>`.

## 0.2.0 (2026-05-01)

### Added

- Run `stack add <provider>` to wire a provider; `--dry-run` previews it.
- **`stack apply`** keeps the `OPENAI_API_KEY` name, never its value.
- Plain entry with no code.
- Spaces inside a span: `  padded  ` and a pipe `a | b`.

## 0.1.0 (2026-04-19)

- Older `stack scan` entry.
