# Changelog

## Unreleased

### Reliability + hardening (auto-agent)

Retry + recovery + secret-redaction pass on `packages/core/`. No other package touched.

- **`fetchWithRetry` shipped** (`packages/core/src/http.ts`) — exponential backoff with jitter, `Retry-After` header honored (integer-seconds + HTTP-date), idempotency auto-derived from `init.method` (GET/HEAD) with explicit opt-in for safe POSTs, abortable via `AbortSignal`. Zero new runtime deps. Threaded through GET healthcheck + verify paths on **all seven providers in scope** (supabase, neon, vercel, github, cloudflare, sentry, plus every `makeApiKeyProvider`-based provider via a new `verifyFetch` helper in `_helpers.ts`). Provision POSTs are deliberately NOT retried — a second call could double-create an upstream resource or double-charge a provider API. Railway + Linear GraphQL POSTs explicitly opt in to `idempotent: true` because they use read-only `{ me }` / `{ viewer }` queries.
- **Partial-failure breadcrumb in the `addService` pipeline** (`packages/core/src/pipeline.ts`) — if `materialize()` throws after `provision()` succeeded, we now persist a minimal `ServiceEntry` (provider, `resource_id`, `region`, `meta`, empty `secrets: []`, `created_by: "stack add (partial)"`) before re-throwing the original error. Leaves a breadcrumb for `stack doctor --fix` or `stack remove` to find and clean up the dangling upstream resource. Documented in a code comment with rationale.
- **Secret-redaction audit** — 15 log sites reviewed across every provider (supabase, neon, vercel, github, cloudflare, sentry, turso, aws, plus the `_api-key` factory); 0 were interpolating raw tokens — all cached-token-invalid warnings use static strings. Added `scrub(value, keepLast?)` helper to `packages/core/src/providers/_helpers.ts` for future use. Verified `formatArgsForError()` in `phantom.ts` still redacts `phantom add KEY VALUE`'s third argument correctly; added a regression test that exercises a failing phantom binary and asserts the raw value never appears in the thrown `StackError`.
- Tests: 3 new files — `http.test.ts` (13 cases: happy path, 429 retry, 500 max-out, Retry-After honored, POST no-retry, explicit idempotent opt-in, network-error retry for idempotent, non-idempotent network error bubbles, custom `retryOn`, AbortSignal mid-retry, + 5 `parseRetryAfter` cases), `pipeline-recovery.test.ts` (2 cases: breadcrumb written on partial failure; dry-run skips breadcrumb), `secret-redaction.test.ts` (8 cases: `scrub` unit tests + cached-token-warning doesn't leak raw secret + `formatArgsForError` redacts `phantom add`'s value). **120 tests, all green** (was 97).
- Sanity: `bun test` green, `bunx tsc --noEmit -p tsconfig.json` clean.

### Marketing surface (auto-agent)

Polish pass on `packages/site/` — landing page + docs, no other package touched.

- **Vercel Web Analytics** — `@vercel/analytics` dependency added; `/_vercel/insights/script.js` loaded defer-ed from `Base.astro`, plus a `referrer-when-downgrade` meta for correct attribution. Ships regardless of plan; no-ops until the Vercel dashboard flag is on.
- **`/docs/changelog`** — renders the repo-root `CHANGELOG.md` as a docs page via `marked` + Vite `?raw` import. Slots under a new "Meta" sidebar group.
- **`/docs/roadmap`** — honest Shipped / In progress / Considering / Explicitly not doing list, dated where possible. Also under "Meta".
- **Launch copy drafts** under `/launch/*` — `hn.md` (Show HN, ≤200 words, `noindex`), `twitter.md` (7-tweet thread with the 🔺 mark, `noindex`), `blog.mdx` (~1000-word "Introducing Ashlr Stack" long-form, indexable, rendered through the Docs layout via a thin `LaunchPost.astro` wrapper). Non-indexable notes use a new `LaunchNote.astro` with minimal self-contained prose styles.
- **`DemoReel.tsx`** — React island that replays a `stack init → stack add supabase → stack exec -- bun dev` sequence as an auto-looping scripted terminal. Shares visuals with the hero `Terminal.tsx` (magenta prompt, green checkmarks, dim notes), respects `prefers-reduced-motion` by snapping to the last frame and pausing, and carries `role="img"` + a descriptive `aria-label` for screen readers. Mounted on the homepage as "§ 03 · In motion — See it run" between the one-command section and the providers grid.
- **MDX integration** — `@astrojs/mdx` added so the blog post can mix prose and code fences freely.
- Build: `bunx astro check` — 48 files, 0 errors / 0 warnings / 0 hints. `bun run build` — 17 pages, sitemap regenerated. Only the existing pre-launch `@import`-order CSS advisory remains.

### Publish + Windows (auto-agent)

Windows support + npm-publish readiness without touching any owner-restricted code (`packages/site/`, `packages/core/src/`, `packages/cli/src/`, `packages/mcp/src/`, `packages/plugin/`):

- **`scripts/install.ps1`** — Windows PowerShell one-liner installer mirroring `scripts/install.sh`. Detects Bun (installs via `irm bun.sh/install.ps1 | iex` if missing), falls back to `npm i -g phantom-secrets` for the vault (no brew on Windows), tries `bun add -g @ashlr/stack ashlr-stack-mcp` first, falls back to git-clone into `$env:LOCALAPPDATA\ashlr-stack` and writes a `stack.cmd` + `ashlr-stack-mcp.cmd` shim into `$env:USERPROFILE\.local\bin` (preferred) or `$env:LOCALAPPDATA\Programs\ashlr-stack\bin`. Warns if the shim dir isn't on PATH. Install body wrapped in `Install-AshlrStack` + a top-level guard so `pwsh -Command { . ./scripts/install.ps1 }` parses without side-effects. Usage: `irm stack.ashlr.ai/install.ps1 | iex`.

- **Per-package README + LICENSE**:
  - `packages/cli/README.md` — technical overview, the three install paths, quickstart, command cheat-sheet for all 22 commands, links to docs.
  - `packages/core/README.md` — short explainer that this is the shared library (not usually installed directly), public-API table (`addService`, `readConfig`/`writeConfig`, `listProviderNames`, `getProvider`, `scanSource`, `detectProvider`, `parseEnv`), example import.
  - `packages/mcp/README.md` — what it is, install, `.mcp.json` snippets for Claude Code / Cursor / Windsurf / Codex, 17 tools grouped by category, 3 resources, links to `stack.ashlr.ai/docs/mcp`.
  - `packages/cli/LICENSE`, `packages/core/LICENSE`, `packages/mcp/LICENSE` — copies of the root MIT LICENSE (npm doesn't traverse up).

- **npm publish shape audit** — verified each published package.json (`@ashlr/stack`, `@ashlr/stack-core`, `ashlr-stack-mcp`) is ship-ready: `files` arrays include only `src/**/*`, `README.md`, `LICENSE`; `publishConfig.access: "public"` present on all three; `bin` paths correct (`./src/index.ts`); `repository.directory` correct; `main`/`exports` correct on core. **Flagged**: `@ashlr/stack` depends on `@ashlr/stack-core` via `workspace:*` — fine for monorepo dev, would break a bare `npm install @ashlr/stack`. Documented this in the root README "Publishing" section rather than hand-editing dev-critical dep ranges.

- **`scripts/publish.sh`** — automated publish dance. Accepts `--version X.Y.Z` (or prompts), backs up each `package.json`, bumps `version`, rewrites every `workspace:*` → `^X.Y.Z`, runs `npm publish --dry-run` for each of the three packages first, prompts for explicit confirmation (bypass with `--yes`), publishes in dep order `core → mcp → cli`, **always restores `workspace:*` via an EXIT trap** so dev keeps working, then tags `v<version>` and pushes the tag. Never publishes without an explicit confirmation.

- **Root `README.md` polish** — added three badges at the top (CI, MIT license, npm version — latter renders "not found" until publish, by design). New "Install" section right under the tagline with three options (macOS/Linux one-liner, Windows PowerShell one-liner, manual `bun add -g`). Prominent link to `STACK.md` for AI-agent readers. New "Publishing" subsection under "Monorepo layout" pointing at `scripts/publish.sh` and explaining the `workspace:*` caveat.

- **Sanity checks**: `bun install`, `bun test` (97 / 0), `bunx tsc --noEmit -p tsconfig.json`, and PowerShell parse check for `scripts/install.ps1` all pass.

### Documentation site — /docs subsection

10 documentation pages under `packages/site/src/pages/docs/`:

- `/docs` — three-card hero to quickstart / providers / CLI
- `/docs/quickstart` — zero → first service in 5 minutes
- `/docs/cli` — full reference for all 22 commands (synopsis / flags / examples / subcommands)
- `/docs/providers` — all 23 providers with auth kind, secret slots, MCP wiring, dashboard + docs URLs
- `/docs/templates` — 5 starters with per-service breakdown
- `/docs/config` — `.stack.toml` committed / `.stack.local.toml` local schema
- `/docs/phantom` — how Stack composes with Phantom Secrets
- `/docs/mcp` — 17 MCP tools + 3 resources for Claude Code / Cursor / Windsurf
- `/docs/ci` — `stack doctor --json` in CI, generated workflow, secrets setup
- `/docs/faq` — top 10 new-user questions

**Docs layout** (`src/layouts/Docs.astro`): sticky left sidebar (`<select>` on mobile), prose column with magenta-accented H2s + inline code, right on-this-page TOC with IntersectionObserver scrollspy, prev/next pagination at the foot of each page.

**Reference data** in `src/lib/` (hand-mirrored from source — Node-only `@ashlr/stack-core` can't ship to the static site bundle):
- `cli-ref.ts` — 22 commands
- `providers-ref.ts` — 23 providers
- `mcp-ref.ts` — 17 tools + 3 resources
- `templates-ref.ts` — 5 templates
- `docs-nav.ts` — sidebar structure + prev/next helper

Build: `bunx astro check` — 41 files / 0 errors. `bun run build` — 11 pages (homepage + 10 docs routes) + `sitemap-index.xml` + `sitemap-0.xml`.

### Landing page visual redesign + SEO/GEO package

Full editorial-technical makeover of the marketing site at `packages/site/`.

**Typography & voice** — swapped Inter for a two-font system: **Instrument Serif** (display, italic-capable) paired with **Geist** (body) and **Geist Mono** (code). Every section now opens with a small-caps `§ NN` editorial rule + a display-serif headline that occasionally italicizes a single phrase for emphasis — trade-magazine-for-infrastructure vibe.

**New motion primitives:**
- `ScrollReveal.astro` — IntersectionObserver-backed fade+lift on viewport enter; staggered children via `--stagger-i` CSS var. Idempotent install, honors `prefers-reduced-motion`.
- `Counter.tsx` — ease-out-cubic count-up from 0→target on first view.
- `MagneticButton.tsx` — 6px-capped cursor-deflection on the primary CTA; falls back to plain button in reduced-motion.
- On-load staggered hero sequence (7 elements, 40–660ms delays) via pure CSS — no JS cost.
- Provider card hover: border + background + 2px lift + brand-color radial underglow.
- Editorial `.edi-rule` dividers (hairline with small-caps label, gradient-masked).
- Sitewide SVG grain overlay for depth.
- Subtle sheen sweep on `btn-primary` via `::before` transform.
- Rotated display-serif "est. 2026" seal behind the hero terminal.
- "Vol. 01 · Issue 2026" corner marks on the hero — tiny but make the page feel **designed**.

**Logo system**: `Logo.astro` now ships three variants (`mark`, `chip`, `wordmark`) with a proper gradient fill and crisp SVG geometry. Same triangle, new precision.

**SEO/GEO package** (agent-delivered, verified):
- Favicon set (SVG + 32/192/512 sizes + apple-touch + PWA manifest).
- OG image (1200x630 SVG), Twitter card (1200x600 SVG).
- `Base.astro` rewritten with typed props for `title` / `description` / `canonical` / `ogImage` / `ogType` / `noindex` / `breadcrumbs`; emits full OG + Twitter + `theme-color` + `color-scheme` + manifest + RSS alternate.
- Three JSON-LD schemas: Organization, WebSite, SoftwareApplication (version `0.1.0-pre-alpha`, no fake `aggregateRating`).
- `@astrojs/sitemap` wired; `sitemap-index.xml` + `sitemap-0.xml` generate at build.
- `robots.txt` with sitemap reference.
- **`llms.txt`** + **`llms-full.txt`** (llmstxt.org standard) — self-contained summaries so LLMs can answer "what is Stack?" without fetching anything else.

**Build**: `bunx astro check` — 0 errors / 0 warnings / 0 hints. `bun run build` — 1 page, ~45 KB gz client JS.

### Commodity polish (env, dry-run, remove-all, picker, completion, CI)

Six week-one features comparable tools ship that Stack was missing:

- **`stack add` (no arg) → interactive picker** — @clack/prompts `select` with the full 23-provider catalog grouped by category + authKind hints. Falls back to an error in non-TTY.
- **`stack add --dry-run`** — describes the four-stage pipeline (login → provision → materialize → persist) without touching Phantom, the network, or `.mcp.json`. Good for "what will this do?" confidence.
- **`stack env set <KEY> <VALUE>`** — direct secret injection. Auto-derives the service from the env-name pattern (falls back to `misc` if unknown); `--service <name>` overrides. `stack env unset <KEY>` removes from both Phantom and `.stack.toml`.
- **`stack remove --all`** — tear down every service with a two-step confirmation (`confirm` + typed `"remove all"`). Non-TTY runs without prompts.
- **`stack completion bash|zsh|fish`** — emits a completion script including live provider + template names baked at runtime. zsh uses `_values`, bash uses `complete -F`, fish uses `complete -c`.
- **`stack ci init`** — scaffolds `.github/workflows/stack-ci.yml` that runs `stack doctor --json` on push + pull_request + nightly cron, pulls from Phantom Cloud, and uploads the doctor report as an artifact.

22 CLI commands total · 5 new tests · 69 tests all green.

### Landing page — stack.ashlr.ai

Premium marketing surface at `packages/site/`. Astro 5 + Tailwind v4 + Framer Motion + React islands. Dark-first, magenta accent.

Sections (in order):
1. **Hero** — ▲ stack mark, gradient headline, working copy-button on the install one-liner, animated `<Terminal/>` running `stack add supabase` end-to-end.
2. **One-command moment** — Framer Motion tab-group with shared `layoutId` pill; "Without Stack" (8 real steps, 45 min) vs "With Stack" (1 command).
3. **Providers grid** — all 23 providers grouped into 11 categories, simple-icons marks inlined at build time.
4. **How it works** — 3-step panel (CLI → Phantom → wiring) with per-step mini terminals and a magenta connector.
5. **Templates** — 5 real templates, each rendered as a card with the real `stack init --template <id>` command.
6. **Claude Code integration** — scripted mock chat UI running `/stack:add supabase` → narration → tool_use → tool_result.
7. **Ashlr constellation** — Stack center + Phantom / ashlr-plugin / ashlrcode satellites connected in SVG.
8. **Footer** — CTA panel + 3-column link tree + giant faded wordmark.

Ships with: `preconnect` on Google Fonts, skip-to-content link, focus-visible rings, `role="tablist"` keyboard nav, WCAG-AA body contrast, responsive 6→4→3→2 grid, `prefers-reduced-motion` respected at both CSS level and inside the two Framer islands. `bun run build` produces a static `dist/` with ~45 KB gz client JS (framer-motion is the majority; only loads on the two interactive islands).

`bunx astro check` — 0 errors · 0 warnings · 0 hints.

### Hardening pass (code review + UX polish)

Independent code review surfaced 6 real issues; independent UX review surfaced 10 gaps. All addressed:

- **Security**: redacted secret values from `phantom ${args}` error messages (was leaking the raw value on non-zero exit). Fake-phantom test harness rewritten to pass all args via `sys.argv` — Python-injection surface closed. `stack clone` now rejects `file://`, `--option-prefixed`, and `ext::` URLs; passes `--` before positional args to git. AWS `materialize` now explicitly validates the `accessKeyId:secretAccessKey` shape instead of silently splitting. OAuth callback server binds port before registering the request handler — eliminates the `redirectUri === ""` race.
- **Correctness**: `DATABASE_URL` no longer auto-attributed to Neon (it's a generic Postgres convention — Supabase, Railway, Render, etc. all use it). Neon now stores connection URIs keyed by project id so cross-project pollution can't happen. Sentry `fetchIdentity` wrapped in try/catch so network errors surface as healthcheck errors, not uncaught throws.
- **Polish**: `stack --version` works. Bare `stack` prints a banner. `outroError` calls `process.exit(1)` so CI actually sees non-zero. Unknown-provider errors group the catalog by category instead of wrapping a comma-soup line. `stack doctor --fix` asks for confirmation before re-running OAuth/provision flows. `stack upgrade` reads `package.json` for the current version instead of a hardcoded string.
- **Dedup**: six providers shipped byte-identical `readLine` + `tryRevealSecret` + `bearerJsonHeaders` — extracted to `packages/core/src/providers/_helpers.ts`. `makeApiKeyProvider` factory now persists the verified key during `login()` (matching hand-written providers), so a failure in `provision`/`materialize` doesn't make users re-paste.
- **MCP server**: `runStack` now surfaces `ENOENT` as a structured `"install the stack CLI or set STACK_BIN"` hint instead of throwing an opaque error back to Claude.
- **Docs**: README provider list updated from stale 20 → 23. Added a "dev install" path. `CHANGELOG.md` now tracks hardening.
- Tests: 4 new test files (security redaction, URL allowlist, helper behaviour, cross-project coexistence) — **64 tests, all green**.

### MCP richness, deps graph, CI output, 2 more providers

- **`stack deps`** — ASCII tree of the current stack grouped by category, annotated with secret slots and MCP wirings. Good for onboarding and template sanity-checks.
- **`stack doctor --json`** — machine-readable per-project report (`{ reports: [{ project, path, services: [{ name, status, detail, latencyMs }] }] }`). Exits non-zero if anything errors. Drop-in for CI pipelines.
- **MCP server enrichment** — `ashlr-stack-mcp` now exposes 17 tools (added `stack_import`, `stack_scan`, `stack_info`, `stack_env_show`, `stack_env_diff`, `stack_providers`, `stack_projects_list`, `stack_deps`, `stack_upgrade`) and registers three resources (`stack://current/.stack.toml`, `.stack.local.toml`, `.mcp.json`) so Claude can read project state without a tool call.
- **Render** — managed deploy platform. API-key paste + `/v1/owners` verification.
- **Firebase** — service-account JSON blob storage; shape-verified (`type: service_account` + `project_id` + `client_email`).

### 3 new providers + visibility commands

- **Cloudflare** — Workers / Pages / R2 / D1 / KV all behind one API token. `stack add cloudflare` verifies the token and stashes `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
- **Turso** — LibSQL edge DB. `stack add turso` creates a new database, auto-mints an auth token, and writes `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- **Convex** — reactive backend. v1 accepts a deploy key; deploy-key shape is structurally validated before storage.
- Scanner rules for all three (including `wrangler.toml`, `@libsql/client`, `convex/`, `CONVEX_DEPLOY_KEY` in `.env.example`, etc.).
- New starter template `cloudflare-turso-clerk` for edge-first projects.
- **`stack info <service>`** — deep-dive on one service: resource, region, auth, docs, dashboard, MCP name, meta, vault presence, live healthcheck.
- **`stack env show` / `stack env diff`** — effective env-var surface. Shows which declared slots are present in Phantom (masked), surfaces vault orphans, or prints just the missing set.
- **`stack upgrade`** — checks the npm registry for a newer `@ashlr/stack` release.

Totals: 21 providers · 19 CLI commands · 5 templates · 49 tests.

### Unified management system

Stack now works on **any project or GitHub repo**, not just one you started with `stack init`.

- **`stack scan`** — detects providers from source: `package.json` / `requirements.txt` / `pyproject.toml` / `go.mod` / `Cargo.toml` plus framework configs (`vercel.json`, `fly.toml`, `railway.json`, `supabase/config.toml`, `sentry.*.config.ts`, `.github/workflows/`) and `.env.example`. Confidence-tiered output. `--auto` runs `stack add` for each detection.
- **`stack clone <github-url>`** — thin wrapper that git-clones a repo, then either recognizes a committed `.stack.toml` or scans the checkout and prints next steps.
- **`stack projects list|register|remove|where`** — cross-project registry backed by `~/.stack/projects.json`. Every `writeConfig` auto-registers. Honors `STACK_REGISTRY_DIR` for test isolation.
- **`stack doctor --all`** — run healthchecks across every registered project in one command.
- **Config split** — `.stack.toml` (committed shape) + `.stack.local.toml` (gitignored instance). Safe to share in git without leaking another developer's Supabase project ref or timestamps. Legacy single-file configs are read transparently and migrated on next write. `.gitignore` is auto-appended on first write.

### Foundations from earlier waves

- 18 curated providers across 7 categories (database / deploy / cloud / analytics / errors / ai / payments / code / tickets / email / auth).
- `stack import [--from .env]` to migrate existing projects.
- Phantom Secrets composition: every secret read/write shells out to `phantom`, never stored by Stack.
- MCP server (`ashlr-stack-mcp`) + Claude Code plugin (`/stack:add`, `/stack:list`, `/stack:doctor`, `/stack:status`).
- 47 tests across 12 files; fetch-mocked provider tests and fake-phantom integration harness.
