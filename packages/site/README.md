# @ashlr/stack-site

Marketing site source for Ashlr Stack, targeting **stack.ashlr.ai**. Deployment is qualified separately.

## Source and verification boundary

The site combines Astro pages and React demos with the shared 39-provider
catalog. Terminal and Claude Code sequences are illustrative browser demos;
they do not run an attached client or prove provider provisioning, credential
storage or application acceptance. Scripts build static output for separate
preview and production qualification.

The source includes responsive layouts, keyboard interactions and
reduced-motion branches. Accessibility, contrast, viewport fit and animated
behavior must be verified against the exact built artifact; this README is
not a universal WCAG or mobile-support receipt. Public delivery, provider
activation and the installed CLI/MCP runtime are separate checks.

GitHub links use `github.com/ashlrai/ashlr-stack`. `build` copies the reviewed
root install scripts into public output and synchronizes the selected
Phantom branding; source presence does not prove those URLs are deployed or
that an installer has been executed successfully. Check current public
package/runtime instructions before using any installation example.

## Run

```bash
cd packages/site
bun install
bun run dev        # http://localhost:4321 (regenerates src/lib/cli-ref.generated.ts first)
bun run build      # static site → ./dist (same pre-steps as dev)
bun run preview    # serve the built site
bun run typecheck  # astro check + tsc --noEmit
```

## Stack

- **Astro 5** — static-first, React islands only where interactivity matters
  (`Terminal`, `OneCommand`, `ClaudeCodeDemo`)
- **Tailwind CSS 4** — via `@tailwindcss/vite`, theme tokens in `src/styles/global.css`
- **Framer Motion** — tasteful, reduced-motion-aware transitions on tabs + chat
- **simple-icons v13** — brand marks inlined at build time from
  `node_modules/simple-icons/icons/*.svg` (see `src/lib/icons.ts`)

## Layout

```
src/
  layouts/Base.astro          # head, OG tags, global chrome
  pages/index.astro           # composes every section
  components/
    Nav.astro
    Logo.astro
    Hero.astro                # left copy + right <Terminal />
    Terminal.tsx              # React island, scripted typing
    OneCommand.tsx            # Framer Motion tab group
    ProvidersGrid.astro       # static, one cell per provider, hover = brand color
    HowItWorks.astro          # 3-step explainer
    Templates.astro           # 5 stack cards
    ClaudeCodeDemo.tsx        # scripted mock Claude Code chat
    Constellation.astro       # 4-node platform map
    Footer.astro              # CTA block + giant wordmark
  lib/
    providers.ts              # display metadata matched to the shared catalog identities
    icons.ts                  # reads simple-icons SVG `d` attrs at build time
  styles/global.css           # Tailwind theme + component utilities
public/
  favicon.svg                 # ▲ in magenta
  og.svg                      # 1200×630 OG image
```

## Design notes

- Keep sample output visibly illustrative and tied to actual command syntax.
  Review copied examples when commands or flags change.
- Do not turn catalog descriptions, mock counts or simulated outcomes into
  customer, provider or runtime acceptance claims.
- Keep credential values out of examples. Dedicated config slots refer to
  names, but user-supplied text and metadata still need review before sharing.
- Preserve reduced-motion and keyboard paths, and verify their behavior on
  the final built artifact.
- Catalog identities come from `packages/core/src/catalog.ts`; category
  counts should follow its current category list rather than old prose.

## License

MIT.

## Agent discoverability checks

Run the production build and inspect the emitted artifacts with:

```bash
HOME=$(mktemp -d) bun test packages/site/tests/discoverability.test.ts # from repo root
```

The test builds through the existing site command and requires Python 3.9 or newer for
standard-library XML parsing. It checks every HTML page's canonical URL,
OpenGraph metadata, description, H1 and heading order; parses JSON-LD; checks
sitemap coverage; and verifies the generated agent index.

`astro build` generates `public/llms.txt` and `dist/llms.txt` from the root README,
rendered documentation headings and `src/data/agent-guide.txt`. Edit those sources,
then rebuild and include the generated index in the change. Source version comes
from the CLI manifest. `llms-full.txt` remains the detailed reviewed reference.
The sitemap excludes launch notes marked noindex. Deployment continues through
the existing merge-to-main path.
