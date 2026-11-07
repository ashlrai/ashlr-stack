# Changelog

## 0.2.2 (2026-10-25)

### Changed

- Site: removed the unused `@vercel/analytics` package (and five other unused site dependencies). Analytics still loads via the inline script tag in `packages/site/src/layouts/Base.astro`, so nothing changes at runtime.
