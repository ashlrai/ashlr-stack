# /docs — build status

**Polished:** the Docs layout (`packages/site/src/layouts/Docs.astro`), the
sticky sidebar, the auto-generated on-this-page TOC with IntersectionObserver
scrollspy, prose typography (headings with magenta rule, inline code, callouts,
tables), and the docs pages in this directory (`index`, `quickstart`, `cli`,
`providers`, `templates`, `config`, `phantom`, `mcp`, `ci`, `faq`, plus `add`,
`changelog`, `for-ai-agents`, `maintenance`, `privacy`, `recipes`,
`recommend`, `roadmap`, `swap`, `telemetry`) — which render
real commands pulled from `packages/cli/src/commands/*.ts` and real provider
metadata from `packages/core/src/providers/*.ts` via the reference files under
`src/lib/` (`docs-nav.ts`, `cli-ref.ts`, `providers-ref.ts`, `mcp-ref.ts`,
`templates-ref.ts`). Syntax highlighting uses Astro's built-in Shiki via the
`<Code>` component with `github-dark-dimmed`. Sidebar collapses to a
`<select>` picker on mobile, TOC hides under `xl:`. Prev/next pagination at
the bottom of every page. Accessible skip-to-content, focus rings, `aria-current`
on the active sidebar link.

**Placeholder / deliberate gaps:** no MDX, no search, no dark/light toggle
(dark-only by design), no per-version docs, no full-text search (would need
Pagefind or Algolia). The CLI reference is generated: `src/lib/cli-ref.generated.ts` is
written by `scripts/gen-cli-ref.ts` (`bun run gen:cli-ref`, which `dev` and
`build` run first) and re-exported from `src/lib/cli-ref.ts`. The provider,
MCP, and template reference data is still mirrored by hand in
`src/lib/providers-ref.ts`, `mcp-ref.ts`, and `templates-ref.ts`, so when a
provider, MCP tool, or template changes, the matching file here needs a manual
update. `/public/llms.txt` links only `/docs/for-ai-agents` among the docs
pages.
