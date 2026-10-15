# /docs — build status

## Source structure

The Docs layout (`packages/site/src/layouts/Docs.astro`) provides the sidebar,
mobile picker, headings and optional table of contents. Documentation pages
combine generated CLI metadata, manually maintained prose and provider/MCP
reference data. Review each example against the actual CLI source; generated
help text and a successful build do not establish provider or runtime
acceptance. Responsive layout, keyboard navigation, focus and reduced-motion
behavior require qualification of the exact built artifact.

## Reference maintenance

Deliberate gaps: no MDX, no search, no dark/light toggle
(dark-only by design), no per-version docs, no full-text search (would need
Pagefind or Algolia). The CLI reference is generated: `src/lib/cli-ref.generated.ts` is
written by `scripts/gen-cli-ref.ts` (`bun run gen:cli-ref`, which `dev` and
`build` run first) and re-exported from `src/lib/cli-ref.ts`. These commands
also synchronize changelog content, install scripts and Phantom branding.
`providers-ref.ts` re-exports the shared core catalog. The MCP and template
reference arrays in `mcp-ref.ts` and `templates-ref.ts` are maintained by hand,
so changes in those runtime contracts need a corresponding reference
update. `public/llms.txt` and `public/llms-full.txt` are maintained discovery
text with documentation links; verify those bytes and rendered routes for the
selected revision. They are not generated from every runtime contract.
