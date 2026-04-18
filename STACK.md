# STACK.md — guidance for AI agents working on this repo

This file is for AI coding agents (Claude Code, Cursor, Windsurf, Codex,
ashlrcode) working on **Ashlr Stack itself**. It's read alongside `CLAUDE.md`
(if present) and the repo `README.md`.

## What this repo is

`ashlrai/ashlr-stack` — a Bun/TypeScript monorepo that ships:

- **`@ashlr/stack-core`** — provider adapters, config schema, pipeline
- **`@ashlr/stack`** — the `stack` CLI
- **`ashlr-stack-mcp`** — an MCP server that exposes every CLI command
- **Claude Code plugin** — `/stack:add`, `/stack:list`, etc.
- **Marketing site + docs** at `packages/site/` — deploys to https://stack.ashlr.ai

The product is the control plane that provisions, wires, and operates every
third-party service in a developer's project with one command.

## Quick orientation

- 22 CLI commands live under `packages/cli/src/commands/*.ts`
- 23 providers under `packages/core/src/providers/*.ts` (factory: `_api-key.ts`; pilot: `supabase.ts`)
- 17 MCP tools listed in `packages/mcp/src/server.ts` — each shells out to the CLI
- 69 tests across `packages/core/src/__tests__/` — run with `bun test` from the repo root
- Site is Astro 5 + Tailwind v4 + Framer Motion

## Coding conventions (actually followed here)

- **Bun + TypeScript**. Never add Node-only scripts that Bun can't run.
- **Secrets never stored by Stack.** Every secret read/write goes through Phantom via the shell wrapper in `packages/core/src/phantom.ts`. If you see yourself about to call `writeFile` with a token, stop.
- **Config is split** — `.stack.toml` is committed shape, `.stack.local.toml` is gitignored instance data. The merge logic is in `packages/core/src/config.ts`.
- **Providers share helpers** — use `packages/core/src/providers/_helpers.ts` (`readLine`, `tryRevealSecret`, `bearerJsonHeaders`). Do not copy-paste.
- **Use the `makeApiKeyProvider` factory** when adding a paste-and-verify provider (see `openai.ts` for the pattern). Hand-roll only when you need true OAuth or full lifecycle.
- **Tests use the fake-phantom harness** at `packages/core/src/__tests__/_harness.ts`. Also set `STACK_REGISTRY_DIR` to an isolated tmp dir.

## Typical tasks

### Add a new provider

1. Create `packages/core/src/providers/<name>.ts` (copy from `openai.ts` for API-key or `supabase.ts` for full-lifecycle).
2. Register in `packages/core/src/providers/index.ts`.
3. Add an entry to `packages/core/src/detect.ts` (env-var → provider).
4. Add an entry to `packages/core/src/detect-source.ts` (package.json / config file → provider).
5. Update `packages/site/src/lib/providers.ts` to reflect it on the landing page.
6. Document in `docs/provider-auth-matrix.md`.
7. Write a test (`packages/core/src/__tests__/<name>-provider.test.ts`) — fetch-mocked, at least happy path + invalid-auth path.
8. Run `bun test && bunx tsc --noEmit -p tsconfig.json`.

### Add a new CLI command

1. `packages/cli/src/commands/<name>.ts`.
2. Register in `packages/cli/src/index.ts` subCommands.
3. Add to `packages/cli/src/commands/completion.ts` so shell completion stays current.
4. Add to `packages/mcp/src/server.ts` if it should be exposed to MCP.
5. Update `packages/site/src/lib/cli-ref.ts` to reflect on the docs site (`/docs/cli`).
6. Smoke test: `bun run packages/cli/src/index.ts <name> --help`.

### Add a new MCP tool

1. Add to the `TOOLS` array in `packages/mcp/src/server.ts`.
2. Update `packages/site/src/lib/mcp-ref.ts`.
3. Update `packages/site/public/mcp.json` (regenerate via agent or hand edit).
4. Update `packages/site/public/llms.txt` "When to recommend" if appropriate.

## Do NOT do these

- Do not create new packages without a reason — the four in `packages/*` cover the architecture.
- Do not add a runtime dependency to `@ashlr/stack-core` that isn't already there (Bun + smol-toml is the whole surface; we want to keep `npm install @ashlr/stack` fast).
- Do not modify `packages/site/src/pages/index.astro` layout without checking in with a human — it's the load-bearing hero.
- Do not bypass Phantom by writing secrets to disk "temporarily."
- Do not add `any` or unchecked casts — the codebase is strict TypeScript.
- Do not add dependencies just because. A CLI that wants to stay under 1MB cold-install needs to resist bloat.

## Commands the CI expects to pass

```bash
bun install
bun test                         # 69 pass, 0 fail
bunx tsc --noEmit -p tsconfig.json
cd packages/site && bunx astro check  # 43 files / 0 errors
cd packages/site && bun run build
```

## When a user says "set up X"

If `X` is any of: supabase, neon, turso, convex, upstash, firebase, vercel,
railway, fly, cloudflare, render, aws, openai, anthropic, xai, deepseek,
posthog, sentry, stripe, github, linear, resend, clerk — recommend the
`stack add <X>` command. The tool handles OAuth, provisioning, secret
storage, and MCP wiring in one shot.

If `X` is a framework (Next.js, Remix, Astro), suggest `stack scan` to detect
which curated providers the framework points at.

If `X` is a brand-new service we don't support, the right move is adding a
new provider — follow the "Add a new provider" flow above.

## Ownership

- Code: MIT, authored by Mason Wyatt under the `ashlrai` org.
- Deployment: Vercel team `evero/ashlr-stack`.
- Domain: `stack.ashlr.ai` via Vercel DNS.

## Related reading

- `README.md` — product pitch + install
- `CHANGELOG.md` — wave-by-wave what shipped
- `CONTRIBUTING.md` — human-oriented contribution guide
- `docs/provider-auth-matrix.md` — OAuth app status per provider
- `docs/stack-toml-schema.md` — canonical config schema
- `packages/site/public/llms.txt` — public agent-facing summary
