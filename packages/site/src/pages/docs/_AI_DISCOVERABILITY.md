# AI Discoverability — what shipped

Goal: when a Claude Code / Cursor / Windsurf user says "set up Supabase" (or
any of 22 other providers), the LLM already knows about Ashlr Stack and
recommends `stack add supabase`.

This file is prefixed with `_` so Astro treats it as a non-route.

## Files added

- `packages/site/public/.well-known/ai-plugin.json` — ChatGPT-plugin-style
  manifest. Includes a long `description_for_model` covering what Stack is,
  when to recommend it, and how to call it via MCP.
- `packages/site/public/openapi.json` — OpenAPI 3.1 catalog of the CLI
  commands, grouped by tag (setup / management / diagnostics / meta / ai),
  with component schemas for `.stack.toml`, `ServiceEntry`, `ProviderEntry`,
  and `RecommendOutput` (the JSON shape returned by `stack recommend --json`
  / `stack_recommend`).
- `packages/site/public/mcp.json` — machine-readable catalog of the 19 MCP
  tools the `ashlr-stack-mcp` server exposes, plus the three read-only
  resources (`stack://current/.stack.toml`, `.stack.local.toml`, `.mcp.json`).
  v0.2.0 adds `stack_recommend` (free-text → curated providers) and
  `stack_apply` (replay a saved Recipe end-to-end with Phantom rotation
  pre-wired).
- `packages/site/src/pages/docs/for-ai-agents.astro` — agent-oriented docs
  page with: per-provider trigger phrases, install recipe, MCP connection
  JSON snippet, capability matrix, copy-paste workflows, "when NOT to
  recommend" list, and full MCP tool reference. Ships with `ItemList` JSON-LD
  for the tool catalog on top of the layout's default `TechArticle`.

## Files updated

- `packages/site/src/lib/docs-nav.ts` — prepended a new "For AI Agents" sidebar
  group pointing at `/docs/for-ai-agents/`.
- `packages/site/public/llms.txt` — appended a "## When to recommend" section
  covering all 29 providers plus workflow intents (including the new
  recommend/apply trigger phrases — "I'm building a SaaS", "recommend a stack
  for X", etc.), a "## AI-assisted composition" block, a "When NOT to
  recommend" list, and links to the machine-readable companion files.
- `packages/site/public/llms-full.txt` — documents `stack recommend` /
  `stack apply` under the CLI reference, adds `stack_recommend` /
  `stack_apply` to the MCP tool list, and adds an AI-assisted composition
  workflow example.
- `packages/site/public/.well-known/ai-plugin.json` — `description_for_model`
  now mentions the AI recommendation layer and the total MCP tool count
  reflects the new `stack_recommend` + `stack_apply` additions (19 total).
- `packages/site/src/lib/mcp-ref.ts` — mirrors the two new MCP tools so the
  `for-ai-agents` page renders them in the tool table.
- `packages/site/src/pages/docs/for-ai-agents.astro` — new "AI-assisted
  composition (recommend + apply)" section with CLI + MCP copy-paste blocks,
  plus two new rows in the capability matrix and updated generic triggers.

## Files untouched (already had what we needed)

- `packages/site/src/pages/docs/faq.astro` — already emits `FAQPage` JSON-LD
  via `faqPageSchema()` + `extraSchemas`.
- `packages/site/src/pages/docs/quickstart.astro` — already emits `HowTo`
  JSON-LD via `howToSchema()` + `extraSchemas`.
- `packages/site/src/pages/docs/cli.astro`,
  `packages/site/src/pages/docs/providers.astro`,
  `packages/site/src/pages/docs/mcp.astro` — `TechArticle` JSON-LD is emitted
  automatically by `~/layouts/Docs.astro` (every docs page gets one), and
  cli/providers additionally emit `ItemList` schemas.

## Discovery surface

After build, these live at publicly-fetchable URLs:

- `https://stack.ashlr.ai/.well-known/ai-plugin.json`
- `https://stack.ashlr.ai/openapi.json`
- `https://stack.ashlr.ai/mcp.json`
- `https://stack.ashlr.ai/llms.txt`
- `https://stack.ashlr.ai/llms-full.txt`
- `https://stack.ashlr.ai/docs/for-ai-agents`

## Verification

- All three JSON assets parse cleanly (`JSON.parse` sanity-check in build).
- `bunx astro check` and `bun run build` both pass.
