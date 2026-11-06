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

- **PNG social cards.** `og.png` (1200x630) and `twitter-card.png` (1200x600) are rasterized from the SVG cards. `DEFAULT_OG_IMAGE` and `DEFAULT_TWITTER_IMAGE` in `src/lib/og.ts` point at them. SVG originals stay in `public/` for browsers. Favicon ICO, `apple-touch-icon.png`, and the 192/512 PNG icons are still not shipped. A multi-size `favicon.ico` needs a separate raster step. SVG favicons cover current browsers.
- **Per-page OG stamping.** `stampOgImage()` returns the shared `/og.png`. It does not overlay a per-page title.
- **RSS feed.** `<link rel="alternate" type="application/rss+xml" href="/feed.xml">` is served by `src/pages/feed.xml.ts`.

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
