# SEO / GEO / brand-asset ship notes

**What's shipped (real, working today):**

- Refined `favicon.svg` with gradient fill + subtle glow, and a simpler `favicon-32.svg` fallback. Wired into `Base.astro` as `<link rel="icon" type="image/svg+xml">`. Modern browsers (Chrome, Safari, Firefox, Edge) all render SVG favicons correctly; no ICO is needed for them.
- `apple-touch-icon.svg`, `icon-192.svg`, `icon-512.svg`, and a `manifest.webmanifest` for PWA + iOS install prompts.
- Polished `og.svg` (1200x630) and `twitter-card.svg` (1200x600) featuring the triangle mark, wordmark, tagline, and a `stack add supabase` terminal snippet. Both are dark, magenta-accented, grid-textured, and legible at small preview sizes.
- Full meta-tag coverage in `Base.astro`: title, description, canonical, OG (site_name, locale, type, url, title, description, image, image:alt, image:width/height), Twitter (summary_large_image, site, creator, title, description, image, image:alt), theme-color (dark/light via media queries), color-scheme, robots, googlebot, preconnect for Google Fonts, manifest link, RSS alternate, sitemap link.
- `~/lib/og.ts` utility: `buildOgMeta()` returns the structured meta tag set for per-page overrides. `stampOgImage()` is a placeholder for the future asset-pipeline hook.
- `~/lib/structured-data.ts`: JSON-LD generators for `Organization` (Ashlr), `WebSite`, `SoftwareApplication` (homepage), and `BreadcrumbList` (sub-pages). No fabricated ratings or review counts — pre-alpha honest.
- `@astrojs/sitemap` integration in `astro.config.mjs`. Generates `/sitemap-index.xml` at build. `trailingSlash: "never"` locks canonical form.
- `robots.txt` explicitly allowing `llms.txt` + `llms-full.txt` and referencing the sitemap.
- **`llms.txt`** and **`llms-full.txt`** following https://llmstxt.org/. `llms.txt` is a self-contained flat summary an LLM can ingest in one shot to answer "what is Stack?" and "how do I install it?". `llms-full.txt` is the long-form reference with every CLI command, every provider's auth flow, config-file schema, MCP tool list, and typical workflows.

**What needs a real asset pipeline in deploy (placeholders today):**

- **PNG rasterization.** We don't ship `og.png`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, or `icon-512.png`. SVG works for modern browsers, Discord, Slack, iMessage, and most social previewers, but:
  - iOS Safari prefers a PNG apple-touch-icon (it'll fall back to the SVG but may not render at peak crispness on home-screen install).
  - Some legacy OG scrapers (older Facebook, LinkedIn) still want PNG. If sharing on those surfaces matters at launch, the deploy pipeline should use `sharp` / `resvg-js` / `satori` to rasterize the SVGs and emit sibling `.png` files, then flip `DEFAULT_OG_IMAGE` in `src/lib/og.ts` to `/og.png`.
  - A true multi-size `favicon.ico` needs `png-to-ico` or similar. Not critical — SVG favicon is sufficient for every target browser released in the last five years.
- **Per-page OG stamping.** `stampOgImage()` in `src/lib/og.ts` is a stub. For real per-page cards (docs pages, blog posts), wire it to a build-time `satori` call that overlays a per-page title onto the base image.
- **RSS feed.** `<link rel="alternate" type="application/rss+xml" href="/feed.xml">` points at a URL that doesn't exist yet. Add `/feed.xml` when we ship a blog or changelog.

**What's intentionally not included:**

- No `aggregateRating` in `SoftwareApplication` schema (pre-alpha, no legitimate reviews).
- No fake download counts, testimonials, or social proof anywhere in meta or JSON-LD.
- No `twitter:site` override — using `@ashlrai` by default, change in `src/lib/og.ts` if the Stack product gets its own handle.

**Build verification:**

```bash
cd packages/site
bun run build          # produces dist/ with sitemap-index.xml
bunx astro check       # type checks the new props on Base.astro
```

**Live-site sanity checks to run post-deploy:**

- `curl -I https://stack.ashlr.ai/robots.txt` returns 200 + references the sitemap.
- `curl https://stack.ashlr.ai/llms.txt` returns the GEO summary (plain text, no HTML).
- `curl https://stack.ashlr.ai/sitemap-index.xml` returns a valid sitemap.
- Paste https://stack.ashlr.ai into https://opengraph.xyz and confirm the card renders.
- Paste https://stack.ashlr.ai into https://search.google.com/test/rich-results and confirm JSON-LD validates.
