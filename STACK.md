# STACK.md — guidance for AI agents working on this repo

This file is for AI coding agents (Claude Code, Cursor, Windsurf, Codex,
ashlrcode) working on **Ashlr Stack itself**. It's read alongside `CLAUDE.md`
(if present) and the repo `README.md`.

## What this repo is

`ashlrai/ashlr-stack` — a Bun/TypeScript monorepo that ships:

- **`@ashlr/stack-core`** — provider adapters, config schema, pipeline
- **`@ashlr/stack`** — the `stack` CLI
- **`ashlr-stack-mcp`**: an MCP server that exposes a subset of CLI commands
- **Claude Code plugin** — `/stack:add`, `/stack:list`, etc.
- **Marketing site + docs** at `packages/site/` — deploys to https://stack.ashlr.ai

The product is the control plane that provisions, wires, and operates every
third-party service in a developer's project with one command.

<!-- fresh:begin version-table -->
| Package | Manifest | Version |
| --- | --- | --- |
| `@ashlr/stack-core` | `packages/core/package.json` | 0.2.2 |
| `@ashlr/stack` | `packages/cli/package.json` | 0.2.2 |
| `ashlr-stack-mcp` | `packages/mcp/package.json` | 0.2.2 |
| `ashlr-stack-monorepo` (private) | `package.json` | 0.1.0 |

Latest released CHANGELOG section: `0.2.2 (2026-10-25)`.
<!-- fresh:end -->

## Quick orientation

- <!-- fresh:begin command-count -->32<!-- fresh:end --> CLI commands live under `packages/cli/src/commands/*.ts` (registered in `packages/cli/src/index.ts`)
- <!-- fresh:begin provider-count -->39<!-- fresh:end --> providers in <!-- fresh:begin category-count -->13<!-- fresh:end --> categories under `packages/core/src/providers/*.ts` (factory: `_api-key.ts`; pilot: `supabase.ts`)
- <!-- fresh:begin tool-count -->19<!-- fresh:end --> MCP tools in the `TOOLS` array of `packages/mcp/src/tools.ts` (served by `server.ts`). Each runs the CLI: `STACK_BIN` if set, else the `stack` bin of the `@ashlr/stack` dependency (`packages/cli/dist/index.js`, present after a build), else `stack` on PATH (`packages/mcp/src/stack-bin.ts`)
- Tests live in `packages/*/src/__tests__/`, `packages/mcp/__tests__/`, `packages/site/tests/` and `scripts/`. Run with `HOME=$(mktemp -d) bun test` from the repo root

## Agent quickstart (from a clone)

```bash
bun install --frozen-lockfile
HOME=$(mktemp -d) bun test                  # full suite, isolated home
bunx tsc --noEmit -p tsconfig.json
bunx biome check .
bun run packages/cli/src/index.ts --help   # the CLI from source
```

Things that trip agents up:

- **No TTY.** Agent shells have no TTY. `stack scan` without flags prints the human report; use `stack scan --json` to parse it. `stack scan --auto` without `--yes` exits 1, since it would ask before each add. `stack init` skips the template picker; pass `--template <name>` (see `stack templates list`).
- **`stack init --dryRun` still writes.** It provisions nothing, but it writes `.stack.toml`, `.stack.local.toml` and `.gitignore` and registers the project in `~/.stack/projects.json`. Run it in a scratch directory, and set `STACK_REGISTRY_DIR` to a temp dir to keep `~/.stack` clean.
- **MCP from source needs the CLI too.** Point the server at the source CLI with `STACK_BIN` (see `packages/mcp/README.md`), or build `packages/cli` so `dist/index.js` exists. Otherwise every tool call fails with "Could not run the 'stack' CLI".
- **MCP tests run the built bundles.** `packages/mcp/__tests__/server.test.ts` drives `packages/mcp/dist/server.js` and `packages/cli/dist/index.js` and only builds them when they are missing. Run `bun run build` after changing CLI or MCP source before trusting an MCP test failure.
- **`stack onboard` edits files in your home directory.** Without `--apply` it only prints a plan. Use `--home <dir>` to point it at a scratch directory.
- **`bun run build` rewrites tracked site files** (`packages/site/public/install.ps1`, `packages/site/src/data/CHANGELOG.md`, `public/llms*.txt`, `public/mcp.json`, `public/openapi.json`, `public/.well-known/ai-plugin.json`, `src/data/site-facts.json` and the generated CLI/MCP/facts references in `src/lib/`). Don't commit that churn with an unrelated change; `git checkout -- packages/site` after a local build.
- **Site facts are generated.** `packages/site/scripts/gen-site-facts.ts` derives every version string, install command, provider/template/tool count and slash-command list the site publishes from the repo sources of truth; it runs as part of `bun run gen:cli-ref` (which `bun run dev`/`build` already invoke). Pages import `~/lib/site-facts.generated`; `src/data/agent-guide.txt` and `src/data/llms-full.txt` use `{{PLACEHOLDER}}` tokens. `packages/site/tests/site-facts.test.ts` fails on drift, including a stale literal version in any page or manifest.
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
4. Add to the `TOOLS` array in `packages/mcp/src/tools.ts` if it should be exposed to MCP.
5. Add the name to `COMMAND_ORDER` (and examples to `EXTRAS`) in `packages/site/scripts/gen-cli-ref.ts`, run `bun packages/site/scripts/gen-cli-ref.ts`, and commit `packages/site/src/lib/cli-ref.generated.ts`. CI fails if the committed copy drifts, and `packages/site/tests/cli-ref.test.ts` fails if it does not list exactly the commands in `stack --help`.
6. Run `bun run fresh:sync` to regenerate the README command table and counts, then `HOME=$(mktemp -d) bun test scripts/docs-freshness.test.ts`.
7. Smoke test: `bun run packages/cli/src/index.ts <name> --help`.

### Add a new MCP tool

1. Add to the `TOOLS` array in `packages/mcp/src/tools.ts`.
2. Run `bun run fresh:sync` to regenerate the README tool table and counts, then `HOME=$(mktemp -d) bun test scripts/docs-freshness.test.ts`.
3. Add its `cli` synopsis to `TOOL_CLI_EXTRAS` in `packages/site/scripts/gen-site-facts.ts`.
4. Run `bun packages/site/scripts/gen-cli-ref.ts`, which regenerates `src/lib/mcp-ref.generated.ts`, `public/mcp.json` and the rest of the site facts.
5. Update `packages/site/src/data/agent-guide.txt` "When to recommend" if appropriate, then run the site build to regenerate `packages/site/public/llms.txt`.

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
bun test                         # 0 fail
bunx tsc --noEmit -p tsconfig.json
bunx biome check .
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
