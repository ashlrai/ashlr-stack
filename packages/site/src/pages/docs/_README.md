# /docs — build status

**Polished:** the Docs layout (`packages/site/src/layouts/Docs.astro`), the
sticky sidebar, the auto-generated on-this-page TOC with IntersectionObserver
scrollspy, prose typography (headings with magenta rule, inline code, callouts,
tables), and the ten docs pages (`index`, `quickstart`, `cli`, `providers`,
`templates`, `config`, `phantom`, `mcp`, `ci`, `faq`) — all of which render
real commands pulled from `packages/cli/src/commands/*.ts` and real provider
metadata from `packages/core/src/providers/*.ts` via four reference files under
`src/lib/` (`docs-nav.ts`, `cli-ref.ts`, `providers-ref.ts`, `mcp-ref.ts`,
`templates-ref.ts`). Syntax highlighting uses Astro's built-in Shiki via the
`<Code>` component with `github-dark-dimmed`. Sidebar collapses to a
`<select>` picker on mobile, TOC hides under `xl:`. Prev/next pagination at
the bottom of every page. Accessible skip-to-content, focus rings, `aria-current`
on the active sidebar link.

**Placeholder / deliberate gaps:** no MDX, no search, no dark/light toggle
(dark-only by design), no per-version docs, no full-text search (would need
Pagefind or Algolia). The provider/CLI/MCP reference data is mirrored by hand
in `src/lib/*-ref.ts` rather than auto-extracted from the source packages —
this avoids a build-time import of Node-only code (fs, citty) into the site
bundle. When a command or provider changes in those packages, the matching
reference file here needs a small manual update. The llms.txt under
`/public/` was not updated to link the new pages; if we want Claude-friendly
discovery of the docs URLs, that's the next small lift.
