# Changelog

## 0.5.0 (2026-07-01)

### Fixed

- **`stack apply <recipe-id>`** keeps `phantom add <NAME>` literal.
- Markdown inside a span is not parsed: `**not bold**`, `[not](a-link)`, `snake_case_name`, `*glob*`.
- Entities stay as typed: `a && b | c` and `&amp;`.
- A [link to `stack doctor`](https://stack.ashlr.ai/docs) keeps its span.
- Padded spans trim one space: `` `tick` `` and `  two  `.

## 0.4.0 (2026-06-01)

- Plain entry without any code.
