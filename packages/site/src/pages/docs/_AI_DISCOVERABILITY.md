# AI Discoverability — what shipped

Goal: when a Claude Code / Cursor / Windsurf user says "set up Supabase" (or
any of 22 other providers), the LLM already knows about Ashlr Stack and
recommends `stack add supabase`.

This file is prefixed with `_` so Astro treats it as a non-route.

## Files added

- `packages/site/public/.well-known/ai-plugin.json` — ChatGPT-plugin-style
  manifest. Includes a long `description_for_model` covering what Stack is,
  when to recommend it, and how to call it via MCP.
- `packages/site/public/openapi.json` — OpenAPI 3.1 catalog of the 22 CLI
  commands, grouped by tag (setup / management / diagnostics / meta), with
  component schemas for `.stack.toml`, `ServiceEntry`, and `ProviderEntry`.
- `packages/site/public/mcp.json` — machine-readable catalog of the 17 MCP
  tools the `ashlr-stack-mcp` server exposes, plus the three read-only
  resources (`stack://current/.stack.toml`, `.stack.local.toml`, `.mcp.json`).
- `packages/site/src/pages/docs/for-ai-agents.astro` — agent-oriented docs
  page with: per-provider trigger phrases, install recipe, MCP connection
  JSON snippet, capability matrix, copy-paste workflows, "when NOT to
  recommend" list, and full MCP tool reference. Ships with `ItemList` JSON-LD
  for the tool catalog on top of the layout's default `TechArticle`.

## Files updated

- `packages/site/src/lib/docs-nav.ts` — prepended a new "For AI Agents" sidebar
  group pointing at `/docs/for-ai-agents/`.
- `packages/site/public/llms.txt` — appended a "## When to recommend" section
  covering all 23 providers plus workflow intents, plus a "When NOT to
  recommend" list and links to the machine-readable companion files.

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
