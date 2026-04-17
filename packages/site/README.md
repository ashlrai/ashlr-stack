# @ashlr/stack-site

Marketing site for Ashlr Stack. Deploys to **stack.ashlr.ai**.

**Polished:** hero + animated terminal, one-command before/after comparison (Framer Motion tabs), 23-provider grid (real simple-icons brand marks, hover → brand color), how-it-works triptych, five template cards with real `stack init --template` commands, mock Claude Code chat showing `/stack:add supabase` end-to-end (MCP tool call + streamed result), Ashlr constellation diagram, footer with giant wordmark. Dark-first with Ashlr magenta (`#d946ef`) accent, full reduced-motion + keyboard-nav support, WCAG-AA contrast on body copy, tuned for `max-w-[1200px]` desktops and collapses cleanly to mobile.

**Placeholder / honest caveats:** the `curl | bash` install URL (`stack.ashlr.ai/install.sh`) resolves only once this site ships with that script at the root. GitHub links point at `github.com/ashlr-ai/stack` — swap the org if the repo lands elsewhere. Sibling links (`phantom.ashlr.ai`, `plugin.ashlr.ai`, `code.ashlr.ai`, `workbench.ashlr.ai`) are aspirational; redirect or stub them server-side. `convex` and `deepseek` don't have entries in simple-icons v13, so they render with minimal custom geometric marks — clearly labeled with their name next to them, but a designer may want to swap these out. The mock Claude Code chat shows one scripted flow; we aren't lying about capability, but no live LLM is running there.

## Run

```bash
cd packages/site
bun install
bun run dev        # http://localhost:4321
bun run build      # static site → ./dist
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
    ProvidersGrid.astro       # static, 23 cells, hover = brand color
    HowItWorks.astro          # 3-step explainer
    Templates.astro           # 5 stack cards
    ClaudeCodeDemo.tsx        # scripted mock Claude Code chat
    Constellation.astro       # 4-node platform map
    Footer.astro              # CTA block + giant wordmark
  lib/
    providers.ts              # curated catalog (source of truth for grid + templates)
    icons.ts                  # reads simple-icons SVG `d` attrs at build time
  styles/global.css           # Tailwind theme + component utilities
public/
  favicon.svg                 # ▲ in magenta
  og.svg                      # 1200×630 OG image
```

## Design notes

- **No fake social proof.** No logos from companies that don't use Stack,
  no "used by 10,000 devs". The project is pre-alpha and says so in the hero chip.
- **Every terminal string is a real command** defined in `packages/cli/src/commands/`.
  If you add or rename a CLI command, grep this site for stale copy.
- **Secrets are never shown.** The `stack add supabase` demo says "stored 3 secrets in
  phantom" — it never displays a fake key.
- **Reduced motion.** Both the hero `<Terminal />` and the Claude Code demo fall back to
  fully-rendered static content when `prefers-reduced-motion: reduce` is set.

## Provider catalog

See `src/lib/providers.ts`. This file is the single source of truth for both the grid
and the template cards. Adding a provider is a two-line change; removing one automatically
updates category counts.

## License

MIT.
