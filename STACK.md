# STACK.md - guidance for AI agents working on this repo

This file is for AI coding agents (Claude Code, Cursor, Windsurf, Codex,
ashlrcode) working on **Ashlr Stack itself**. It's read alongside `CLAUDE.md`
(if present) and the repo `README.md`.

## What this repo is

`ashlrai/ashlr-stack` - a Bun/TypeScript monorepo that ships:

- **`@ashlr/stack-core`** - provider adapters, config schema, pipeline
- **`@ashlr/stack`** - the `stack` CLI
- **`ashlr-stack-mcp`**: an MCP server that exposes a subset of CLI commands
- **Claude Code plugin** - `/stack:add`, `/stack:list`, etc.
- **Marketing site + docs** at `packages/site/` - deploys to https://stack.ashlr.ai

Stack configures supported third-party services through provider-specific
authentication, provisioning and selected vault/config/MCP writes. Inspect
partial outcomes; catalog registration does not establish provider readiness.

### Where it fits

Stack is the service layer of the Ashlr ecosystem: Phantom (`phm`) runs the
agents, Phantom Secrets (`phantom`) holds the secrets Stack selects, Locus
(`locus`) pins the account a session acts as (`stack exec --as`), and
Lexicon, Ashlr Markdown and the ashlr plugin sit alongside. Together they aim
to be an autonomous, code-first, agent-native software factory, chasing
open-source RSI (recursive self-improvement), with the human as a passive board
member. The full table is in
[README.md](README.md#part-of-the-ashlr-ecosystem).
`stack doctor --ecosystem --json` reports which of these tools are installed
and changes nothing.

Agents ship changes to this repo themselves: branch, open a PR, merge once the
required checks pass. The limits they keep (secrets, billing, force-push, the
hold list) and the changelog rule are in
[AGENTS.md](AGENTS.md).

<!-- fresh:begin version-table -->
| Package | Manifest | Version |
| --- | --- | --- |
| `@ashlr/stack-core` | `packages/core/package.json` | 0.3.10 |
| `@ashlr/stack` | `packages/cli/package.json` | 0.3.10 |
| `ashlr-stack-mcp` | `packages/mcp/package.json` | 0.3.10 |
| `ashlr-stack-monorepo` (private) | `package.json` | 0.1.0 |

Latest dated CHANGELOG section: `0.3.10 (2026-11-10)`.
<!-- fresh:end -->

## Quick orientation

- <!-- fresh:begin command-count -->47<!-- fresh:end --> CLI commands live under `packages/cli/src/commands/*.ts` (registered in `packages/cli/src/index.ts`)
- <!-- fresh:begin provider-count -->39<!-- fresh:end --> providers in <!-- fresh:begin category-count -->13<!-- fresh:end --> categories under `packages/core/src/providers/*.ts` (factory: `_api-key.ts`; pilot: `supabase.ts`)
- <!-- fresh:begin tool-count -->19<!-- fresh:end --> MCP tools in the `TOOLS` array of `packages/mcp/src/tools.ts` (served by `server.ts`). Each runs the CLI: `STACK_BIN` if set, else the `stack` bin of the `@ashlr/stack` dependency (`packages/cli/dist/index.js`, present after a build), else `stack` on PATH (`packages/mcp/src/stack-bin.ts`)
- Tests live in `packages/*/src/__tests__/`, `packages/mcp/__tests__/`, `packages/site/tests/`, `scripts/`, `test/` (package manifests, CLI exit codes, git hooks) and `tests/` (mostly changelog parsing and parity). Run with `HOME=$(mktemp -d) bun test` from the repo root
- The four `*.node-tests.mjs` files under `scripts/` use `node:test`, so `bun test` skips them. Run them with Node: `bun run check:crypto` runs `scripts/check-crypto.node-tests.mjs`, `bun run fresh:test` runs `scripts/freshness/freshness.node-tests.mjs`, `scripts/mcp-registry-gate.test.ts` drives `scripts/mcp-registry-gate.node-tests.mjs`, and `node --test scripts/pkg-module-type.node-tests.mjs` runs the last

## Agent quickstart (from a clone)

```bash
bun install --frozen-lockfile
HOME=$(mktemp -d) bun test                  # full suite, isolated home
bunx tsc --noEmit -p tsconfig.json
bunx biome check .
bun run packages/cli/src/index.ts --help   # the CLI from source
bash scripts/fast-check.sh                 # typecheck + test packages changed vs origin/main
```

`scripts/fast-check.sh` includes uncommitted work but only looks under
`packages/`, and it tests only the packages that changed. The core, CLI, MCP
and site tests read each other's sources, so for committed changes anywhere in
the repo, `scripts/affected-tests origin/main` lists the tests to run; a change
to any of those four, or to `packages/plugin`, selects all four
([details](scripts/affected-tests.md)). It prints `[]` for doc-only changes,
but many tests read docs by name; CONTRIBUTING.md shows how to find them. The full contributor path is in
[CONTRIBUTING.md](CONTRIBUTING.md#contribute-with-an-agent).

Things that trip agents up:

- **No TTY.** Agent shells have no TTY. `stack scan` without flags prints the human report; use `stack scan --json` to parse it. `stack scan --auto` without `--yes` exits 1, since it would ask before each add. See [scan troubleshooting](docs/scan-troubleshooting.md) for errors and recovery. `stack init` skips the template picker; pass `--template <name>` (see `stack templates list`).
- **`stack init --dryRun` still writes.** It provisions nothing, but it writes `.stack.toml`, `.stack.local.toml` and `.gitignore` and registers the project in `~/.stack/projects.json`. Run it in a scratch directory, and set `STACK_REGISTRY_DIR` to a temp dir to keep `~/.stack` clean.
- **MCP from source needs the CLI too.** Point the server at the source CLI with `STACK_BIN` (see `packages/mcp/README.md`), or build `packages/cli` so `dist/index.js` exists. Otherwise every tool call fails with "Could not run the 'stack' CLI".
- **MCP tests run the built bundles.** `packages/mcp/__tests__/server.test.ts` drives `packages/mcp/dist/server.js` and `packages/cli/dist/index.js` and only builds them when they are missing. After changing CLI or MCP source, run `bun run --cwd packages/cli build && bun run --cwd packages/mcp build` before trusting an MCP test failure. Root `bun run build` works too but also builds the site, which rewrites tracked files (see below).
- **`stack onboard` edits files in your home directory.** Without `--apply` it only prints a plan. Use `--home <dir>` to point it at a scratch directory.
- **`bun run build` rewrites tracked site files** (`packages/site/public/install.ps1`, `packages/site/src/data/CHANGELOG.md`, `public/llms*.txt`, `public/mcp.json`, `public/openapi.json`, `public/.well-known/ai-plugin.json`, `src/data/site-facts.json` and the generated CLI/MCP/facts references in `src/lib/`). Review the generated diff after a local build and keep only changes relevant to your work. Preserve any pre-existing site edits when cleaning up generated files.
- **Site facts are generated.** `packages/site/scripts/gen-site-facts.ts` derives every version string, install command, provider/template/tool count and slash-command list the site publishes from the repo sources of truth; it runs as part of `bun run gen:cli-ref` (which `bun run dev`/`build` already invoke). Pages import `~/lib/site-facts.generated`; `src/data/agent-guide.txt` and `src/data/llms-full.txt` use `{{PLACEHOLDER}}` tokens. `packages/site/tests/site-facts.test.ts` fails on drift, including a stale literal version in any page or manifest.
- Site is Astro 5 + Tailwind v4 + Framer Motion

## Coding conventions (actually followed here)

- **Bun + TypeScript**. Never add Node-only scripts that Bun can't run.
- **Persist selected secrets through Phantom.** Stack handles credentials in memory during setup and reads existing env files during import. Vault reads/writes go through `packages/core/src/phantom.ts`; do not write credential values to project files, logs or agent output. MCP text and freeform configuration are not a general redaction boundary.
- **Config is split** - `.stack.toml` is committed shape, `.stack.local.toml` is gitignored instance data. The merge logic is in `packages/core/src/config.ts`.
- **Providers share helpers** - use `packages/core/src/providers/_helpers.ts` (`readLine`, `tryRevealSecret`, `bearerJsonHeaders`). Do not copy-paste.
- **Use the `makeApiKeyProvider` factory** when adding a paste-and-verify provider (see `openai.ts` for the pattern). Hand-roll only when you need true OAuth or full lifecycle.
- **Tests use the fake-phantom harness** at `packages/core/src/__tests__/_harness.ts`. Also set `STACK_REGISTRY_DIR` to an isolated tmp dir.

## Typical tasks

### Add a new provider

1. Create `packages/core/src/providers/<name>.ts` (copy from `openai.ts` for API-key or `supabase.ts` for full-lifecycle).
2. Register in `packages/core/src/providers/index.ts`, and add its `PROVIDERS_REF` entry in `packages/core/src/catalog.ts` (tests fail if the registry and catalog disagree).
3. Add an entry to `packages/core/src/detect.ts` (env-var → provider).
4. Add an entry to `packages/core/src/detect-source.ts` (package.json / config file → provider).
5. Update `packages/site/src/lib/providers.ts` to reflect it on the landing page.
6. Document in `docs/provider-auth-matrix.md`: a table row and the provider count in its header.
7. Write a test. For an API-key provider, add a spec to `SPECS` in `packages/core/src/__tests__/api-key-providers.test.ts`; for any other kind, add a fetch-mocked `packages/core/src/__tests__/<name>-provider.test.ts` (see `neon-provider.test.ts`).
8. Regenerate the counts: `bun run fresh:sync` (README and this file), `bun run --cwd packages/site gen:cli-ref` (site facts and `public/llms-full.txt`) and the site build (`public/llms.txt`). Commit the results.
9. Run `HOME=$(mktemp -d) bun test` and `bun run typecheck`.

The full checklist is [docs/adding-a-provider.md](docs/adding-a-provider.md).

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

- Do not create new packages without a reason - the six in `packages/*` (core, cli, mcp, plugin, site, telemetry-worker) cover the architecture.
- Do not add a runtime dependency to `@ashlr/stack-core` that isn't already there (Bun + smol-toml is the whole surface; we want to keep `npm install @ashlr/stack` fast).
- Do not change the layout of `packages/site/src/pages/index.astro` as a side effect of other work. It is the landing hero: change it only in a PR whose stated purpose is the hero, and check the built page (`bun run --cwd packages/site build`) before it merges. This is a scope rule, not a human sign-off; [AGENTS.md](AGENTS.md) has no approval steps.
- Do not bypass Phantom by writing secrets to disk "temporarily."
- Do not add `any` or unchecked casts - the codebase is strict TypeScript.
- Do not add dependencies just because. A CLI that wants to stay under 1MB cold-install needs to resist bloat.

## Commands the CI expects to pass

Pull requests and the merge queue need only the **CI Gate** check: typecheck,
the Tier-1 security tests, `bun run check:crypto` and two secret scans (the
table is in [CONTRIBUTING.md](CONTRIBUTING.md#what-ci-requires)). The full set
below mirrors the daily run on `main` in `.github/workflows/ci.yml`, and a red
daily run opens a FIX-MAIN issue, so run it locally before a large change. Every
line runs from the repo root:

```bash
bun install --frozen-lockfile
HOME=$(mktemp -d) bun test                       # full suite, isolated home
bunx tsc --noEmit -p tsconfig.json
bunx biome check .
bun run packages/cli/src/index.ts --help         # CLI smoke
bun run packages/cli/src/index.ts providers      # catalog smoke
bun run packages/cli/src/index.ts recommend "B2B SaaS with auth and payments" --json  # CI expects stripe in .hits
bun run --cwd packages/cli build && bun run --cwd packages/mcp build
node packages/cli/dist/index.js --help > /dev/null
node scripts/node-smoke.mjs                      # dist bundles under Node 20+
node scripts/release-preflight.mjs               # pack + install the npm tarballs; never publishes
bun run --cwd packages/site astro check          # expect 0 errors; file count varies
bun run --cwd packages/site build
git diff --exit-code -- packages/site/src/lib/cli-ref.generated.ts  # committed CLI reference is current
```

CI runs the test and smoke lines on Bun 1.2.0 and the latest release, and
release preflight on the latest release only. If the CLI reference check
fails, regenerate it with `bun packages/site/scripts/gen-cli-ref.ts` and
commit `packages/site/src/lib/cli-ref.generated.ts`.

The site build rewrites tracked generated files (see "Things that trip agents
up" above); review that diff before you commit.

## When a user says "set up X"

If `X` is a registered provider, recommend the `stack add <X>` command. The
registry in `packages/core/src/providers/index.ts` has these ids: anthropic,
auth0, aws, braintrust, clerk, cloudflare, convex, datadog, deepseek,
digitalocean, firebase, fly, gcp, github, grafana, hetzner, launchdarkly,
linear, mailgun, mixpanel, modal, neon, openai, plausible, posthog, postmark,
railway, render, replicate, resend, sendgrid, sentry, stripe, supabase, turso,
upstash, vercel, workos, xai. `stack providers --json` prints the list for the
installed version; check it before calling a service unsupported. Authentication may use OAuth or supplied credentials,
depending on the adapter. Setup attempts supported provisioning and selected
vault/config/MCP writes; inspect failures and partial state before reporting
success.

If `X` is a framework (Next.js, Remix, Astro), suggest `stack scan` to detect
which curated providers the framework points at.

If `X` is a brand-new service we don't support, the right move is adding a
new provider - follow the "Add a new provider" flow above.

## Ownership

- Code: MIT, copyright AshlrAI, Inc. (see [LICENSE](LICENSE)), in the `ashlrai` GitHub org.
- Site deploys: `.github/workflows/deploy-site.yml` ships `packages/site` to Vercel on each merge to `main` that touches the site or its sources.
- Domain: `stack.ashlr.ai`.

## Related reading

- `README.md` - product pitch + install
- `CHANGELOG.md` - wave-by-wave what shipped
- `CONTRIBUTING.md` - first-time contributor path for humans and agents: fork, checks, what CI Gate requires, merge
- `docs/provider-auth-matrix.md` - OAuth app status per provider
- `docs/stack-toml-schema.md` - canonical config schema
- `packages/site/public/llms.txt` - public agent-facing summary

## DeepWiki configuration

The root [`.devin/wiki.json`](.devin/wiki.json) steers DeepWiki using repository
notes and an explicit page list. DeepWiki generates only the listed pages when
this file is present, so update the list when major areas or relationships
change. Keep page purposes tied to source paths and distinguish source behavior
from released capabilities. Both `repo_notes` and a nonempty `pages` array are
required; page titles must be unique, and a `parent` names another page title.
See [Devin's configuration reference](https://docs.devin.ai/work-with-devin/deepwiki#steering-deepwiki)
for current limits and regeneration instructions. The configuration guides wiki
generation; adding it alone does not connect or regenerate a repository wiki.
