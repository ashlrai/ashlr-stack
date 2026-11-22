# Ashlr Stack

[![CI](https://github.com/ashlrai/ashlr-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/ashlrai/ashlr-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/ashlrai/ashlr-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/ashlrai/ashlr-stack)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![npm version](https://img.shields.io/npm/v/@ashlr/stack.svg)](https://www.npmjs.com/package/@ashlr/stack)
[![Stars](https://img.shields.io/github/stars/ashlrai/ashlr-stack?style=flat&label=stars)](https://github.com/ashlrai/ashlr-stack/stargazers)
<!-- fresh:begin version-badge -->
[![source v0.3.10](https://img.shields.io/badge/source-v0.3.10-blue.svg)](CHANGELOG.md)
<!-- fresh:end -->

**Configure supported services from your terminal or your AI agent.** Stack uses provider-specific OAuth or supplied credentials, provisions where the adapter supports it, and records selected credentials in [Phantom Secrets](https://phm.dev/secrets), Stack configuration and provider MCP entries. Vercel requires an existing personal access token; Stack does not create that token. Export an empty `.env.example` separately with `stack env export --example`.

New projects stall on account setup, copied keys, and agent config. Stack turns the supported part of that work into commands an agent can run and parse.

![An agent runs read-only Stack commands and gets JSON back](docs/assets/readme-hero.svg)

## Get started

Use Node.js 20 or newer. No account or API key is needed for this first command.

1. Install the CLI: `npm i -g @ashlr/stack`.
2. Run `stack providers --json`.
3. Look for `schema: "ashlr.stack.providers/v1"`, a `total`, and a `providers` list with names, categories, and authentication methods. An empty `unavailable` list means every provider loaded.

This command reads the bundled catalog without configuring services. If your shell cannot find `stack`, reopen it after installation. For more tasks, use the [command map](docs/cli-command-map.md) or the examples below.

### Try more read-only commands

Agents: read [llms.txt](https://stack.ashlr.ai/llms.txt) (short index) and [llms-full.txt](https://stack.ashlr.ai/llms-full.txt) (full reference). In this repo those files are [packages/site/public/llms.txt](packages/site/public/llms.txt) and [packages/site/public/llms-full.txt](packages/site/public/llms-full.txt).

These four commands are read-only. They need no account and no API key. They print JSON and write nothing. Node.js 20 or newer is what the published 0.3.10 packages declare. More copy-paste blocks: [docs/examples.md](docs/examples.md).

```bash
npx -y -p @ashlr/stack stack providers --json
npx -y -p @ashlr/stack stack recommend "B2B SaaS with auth, AI, and payments" --json
npx -y -p @ashlr/stack stack scan --json
npx -y -p @ashlr/stack stack templates list --json
```

The recommend JSON has `query`, `hits`, `byCategory`, and `guidance`. `stack scan --json` returns `{ "hits": [] }` in an empty directory.

After install, this prints a plan and writes nothing:

```bash
stack onboard --json
```

### MCP server

The same stdio server works for Claude Code, Codex, and Cursor. Each tool runs the `stack` CLI. If no CLI can be launched, the server can still list tools, and tool calls return `Could not run the 'stack' CLI`.

Claude Code:

```bash
claude mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp
```

Codex:

```bash
codex mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp
```

Cursor, in `~/.cursor/mcp.json` or the project `.mcp.json`:

```json
{
  "mcpServers": {
    "ashlr-stack": {
      "command": "npx",
      "args": ["-y", "-p", "@ashlr/stack", "-p", "ashlr-stack-mcp", "ashlr-stack-mcp"]
    }
  }
}
```

Claude Code can also install the plugin. Paste these in the Claude session:

```text
/plugin marketplace add ashlrai/ashlr-stack
/plugin install stack@ashlr
```

That adds `/stack:add`, `/stack:apply`, `/stack:doctor`, `/stack:list`, `/stack:recommend`, and `/stack:status`.

## How it works

![Read JSON, authorize a provider, then Stack records config and selected secrets](docs/assets/readme-how-it-works.svg)

1. **Read.** The four commands in the start block only print data.
2. **Authorize.** A later write uses that provider's OAuth, a personal access token, or an API key you supply. Vercel does not get a new token from Stack.
3. **Record.** When you ask Stack to add a service, it stores selected secrets in Phantom, writes `.stack.toml` (committed shape) and `.stack.local.toml` (gitignored ids), and can add provider MCP entries. It does not generate your app or a filled `.env`. `stack env export --example` writes an empty `KEY=` file at `.env.example`.

## Part of the Ashlr ecosystem

Stack is one tool in the Ashlr ecosystem. Together these tools aim to be an autonomous, code-first, agent-native software factory, chasing open-source RSI (recursive self-improvement). Agents do the work, and the human acts as a passive board member. Stack's job in that factory is the service layer: it turns provider setup into commands an agent can run and parse.

| Tool | Command | Role |
|---|---|---|
| Phantom (`@ashlr/phantom`) | `phm` | Runs the agents that improve these repos, for example `phm improve`. |
| [Phantom Secrets](https://github.com/ashlrai/phantom-secrets) | `phantom` | Vault. Stack stores the secrets you select here. |
| [Locus](https://github.com/ashlrai/locus) | `locus` | Identity plane. Pins which account a session acts as; `stack exec --as` uses it. |
| [Lexicon](https://github.com/ashlrai/lexicon) | `lexicon` | Voice lexicon. Keeps dictated names spelled right. |
| [Ashlr Markdown](https://github.com/ashlrai/ashlr-md) | `mdopener-mcp` | Desktop Markdown app with an MCP server. |
| [Ashlr plugin](https://github.com/ashlrai/ashlr-plugin) | `ashlr-plugin` | Plugin for Claude Code and Codex. |
| Ashlr Stack (this repo) | `stack` | Configures services and wires them into agents. |

`stack doctor --ecosystem` shows which of these are installed, with versions. It is read-only and never fails. `stack doctor --ecosystem --install` prints install commands for missing tools and runs nothing. A full walkthrough is in [docs/getting-started-ecosystem.md](docs/getting-started-ecosystem.md).

**How agents work on this repo.** Phantom and other coding agents open branches and pull requests here and merge them once required checks pass, without a manual approval step. The rules they follow, and the few limits they keep (secrets, billing, force-push), are in [AGENTS.md](AGENTS.md). Build and test steps are in [STACK.md](STACK.md#agent-quickstart-from-a-clone). Every doc in `docs/` is listed by topic in [docs/README.md](docs/README.md).

## Features

![JSON CLI, one MCP server, and the llms.txt indexes](docs/assets/readme-features.svg)

- **JSON for agents.** Put `--json` after the subcommand: `stack providers --json`. A flag the command does not declare exits 1 and names the closest real option.
- **One MCP server.** Claude Code, Cursor, and Codex share the snippet above. The server declares <!-- fresh:begin tool-count -->19<!-- fresh:end --> tools, a subset of the CLI. Tool results are CLI text plus an `isError` flag. They are not a secret-redaction boundary.
- **Phantom holds selected secrets.** Stack handles credential values in memory during setup. Persistent entries go through Phantom. Talk about slot names, not secret values.
- **Local service removal.** `stack remove <service> --json` removes local configuration and MCP wiring and reports any retained vault names in `secrets_kept`. Headless removal can leave secrets in Phantom; upstream resources are retained. See [removal examples](docs/examples.md#remove-local-service-wiring).
- **Fleet diagnostics.** `stack fleet` and the other fleet commands report fleet state from local data or GitHub. `stack fleet-act --apply` appends an audit request; a separate dispatcher must consume it. See [fleet commands](docs/fleet-commands.md). The core package also exports a staged job runner for structured run records; see [job run records](docs/fleet-job-runs.md).
- **Updates on request.** `stack upgrade` checks npm; `stack upgrade --apply` can upgrade an eligible npm global installation with health checks and rollback. `--dryRun` prevents installation. The MCP upgrade tool only checks.
- **Catalog in this checkout.** It registers <!-- fresh:begin provider-count -->39<!-- fresh:end --> providers across <!-- fresh:begin category-count -->13<!-- fresh:end --> categories. Registration is not provider acceptance. Run `stack providers --json` for the install you have.

## Install

The npm command in [Get started](#get-started) installs the CLI. To also install the MCP server:

npm / bun registry:

> Verified November 15, 2026: npm serves 0.3.10 for all three Stack packages, each declaring Node.js 20 or newer, and the [v0.3.10 GitHub release](https://github.com/ashlrai/ashlr-stack/releases/tag/v0.3.10) provides macOS/Linux arm64/x64 binaries and checksum sidecars. Check `npm view @ashlr/stack-core version`, `npm view @ashlr/stack version` and `npm view ashlr-stack-mcp version` for current versions. This checkout declares the source version shown above; a source version alone does not establish publication. Source development uses Bun.

```bash
npm i -g @ashlr/stack ashlr-stack-mcp
# or: bun add -g @ashlr/stack ashlr-stack-mcp
```

**Dev install** (this repo):

```bash
git clone https://github.com/ashlrai/ashlr-stack && cd ashlr-stack
bun install --frozen-lockfile
bun run packages/cli/src/index.ts --help
```

Run source commands with `bun run packages/cli/src/index.ts <command>`. For MCP from source, build the CLI (`bun run --cwd packages/cli build`) or set `STACK_BIN`. `--frozen-lockfile` installs exactly what `bun.lock` pins, as CI does, so the lockfile stays out of your diff. Agents working on this repo should read [AGENTS.md](AGENTS.md) and [STACK.md](STACK.md); the checks to run before a PR are in [CONTRIBUTING.md](CONTRIBUTING.md#contribute-with-an-agent).

**Status:** pre-alpha, active development. This source line adds fleet diagnostics and stricter input validation on top of the Node-compatible CLI and headless workflows; this checkout is version <!-- fresh:begin version-pin -->0.3.10<!-- fresh:end -->. See [CHANGELOG.md](./CHANGELOG.md) for compatibility notes and changes since 0.2.2. Source versions do not establish npm publication or provider readiness. Check `npm view @ashlr/stack version`, `npm view ashlr-stack-mcp version`, and your installed `stack --version` before relying on release-specific commands.

## Providers

A subset of the catalog:

- **Database:** Supabase, Neon, Turso, Convex, Upstash, Firebase
- **Deploy:** Vercel, Railway, Fly.io, Cloudflare, Render
- **Cloud:** AWS
- **AI:** OpenAI, Anthropic, xAI, DeepSeek
- **Analytics:** PostHog
- **Errors:** Sentry
- **Payments:** Stripe
- **Code:** GitHub
- **Tickets:** Linear
- **Email:** Resend
- **Auth:** Clerk

`stack providers --json` is the full list for your install, including `authKind` and docs links.

## Commands

This checkout registers <!-- fresh:begin command-count -->47<!-- fresh:end --> top-level commands. Run `stack <command> --help` for the flags your install actually has. Options go after the subcommand.

<!-- fresh:begin commands-table -->
| Command | Purpose |
| --- | --- |
| `stack init` | Scaffold a .stack.toml in the current directory. |
| `stack import` | Import an existing .env into Phantom + .stack.toml. |
| `stack scan` | Detect providers used by this repo (package.json, config files, .env.example). |
| `stack clone` | Clone a GitHub repo and auto-detect its Stack services. |
| `stack add` | Provision a service and wire its secrets + MCP entry. |
| `stack remove` | Remove local service config and MCP wiring; attempt Phantom secret removal (headless runs may retain secrets). |
| `stack list` | List services configured in this stack. |
| `stack info` | Show everything Stack knows about a configured service. |
| `stack status` | Show stack health at a glance. |
| `stack env` | Inspect the effective env-var map for this stack. |
| `stack deps` | Show the service dependency graph for this stack. |
| `stack doctor` | Verify every service is reachable and credentials are valid. |
| `stack fleet-lanes` | Report lane targets, running and queued work, and dispatch idle reasons. |
| `stack fleet-supply` | Report hourly launches, observed lane idle minutes, restock errors and UTF-8 queue splits. |
| `stack fleet-latency` | Report per-repo median and p90 open-to-merge seconds for PRs merged in the last six hours. |
| `stack fleet-lag` | Report per-repo commits since latest tag, tag age and median time for the last 20 merged PRs. |
| `stack fleet-waste` | Report per-lane launches, empty finishes, precheck skips by code and unfinished jobs. |
| `stack fleet-reds` | List failed jobs and first failing tests in the latest completed schedule/push CI runs. |
| `stack fleet-silent` | Name silent fleet failures in author, dispatch and job logs (read-only JSON). |
| `stack fleet-collisions` | Rank touched files by open conflicting PR count from one repository's gh JSON. |
| `stack fleet-delivery-lag` | Report undeployed merged commits and merge wait from a read-only JSON fixture. |
| `stack fleet-stuck` | List open PRs by merge state, age and auto-merge status with server/ and lockfile path hints. |
| `stack fleet-slo` | Compare per-repo six-hour merges, open-to-merge latency and conflicting PRs with fleet SLO targets. |
| `stack fleet-act` | Preview fleet requests; --apply appends a v1 audit request for a dispatcher consumer. |
| `stack fleet-stream` | Translate fleet logs to typed NDJSON or localhost SSE. |
| `stack fleet-graph` | Emit schema-versioned fleet pool, job, and repository nodes and edges. |
| `stack worktree-disk` | Rank registered worktrees by disk usage (read-only). |
| `stack fleet-gc` | Dry-run report classifying fleet worktrees as preserved or collect-candidates (read-only). |
| `stack fleet-bets` | Score leader bets: join queue ledger ids with dispatch state and job outcomes for per-bet status and per-lane merged rate. |
| `stack fleet-match` | Map a job requirement to eligible fleet resources by capability, quota and availability. |
| `stack fleet-sheet-status` | Report per-sheet last successful sync and staleness, or reconcile one failed execution. |
| `stack fleet` | Show repository CI, open PR counts, and dispatcher lane status. |
| `stack exec` | Run a command with Phantom's secret proxy active. |
| `stack swap` | Migrate a project from one provider to an equivalent in the same category. |
| `stack sync` | Push secrets to a deployment platform (via phantom sync). |
| `stack onboard` | Detect Codex, Claude Code, Cursor and Gemini CLI and register the Phantom gateway in each (plan by default). |
| `stack open` | Open a service's dashboard in your browser. |
| `stack login` | Refresh OAuth / PAT credentials for a specific provider. |
| `stack telemetry` | Opt into / out of anonymous usage telemetry. See docs/PRIVACY.md. |
| `stack templates` | List or apply starter stack templates. |
| `stack providers` | List every curated provider Stack can wire up. |
| `stack recommend` | Pick the right providers for what you're building (AI-assisted). |
| `stack apply` | Apply a saved recipe: provision each provider, check its secrets in Phantom, and add webhook stubs. |
| `stack projects` | Manage the cross-project registry at ~/.stack/projects.json. |
| `stack ci` | CI workflow generation (unavailable; use `stack doctor` instead). |
| `stack completion` | Emit shell completion for bash, zsh, or fish. |
| `stack upgrade` | Check for a release or safely upgrade an npm global CLI install. |
<!-- fresh:end -->

### Options by command

Root options go before a command; other options go after the command shown. Use `stack <command> --help` for descriptions, values, and positional arguments. A dash means that help lists no options.

| Command | Options |
| --- | --- |
| `stack` | `-v`, `--version`, `--json`, `--ashlrHandshake` |
| `stack init` | `--template`, `--force`, `--noInteractive`, `--noProvision`, `--dryRun`, `--noRollback` |
| `stack import` | `--from`, `--dryRun`, `--json` |
| `stack scan` | `--path`, `--auto`, `--yes`, `--confidence`, `--json` |
| `stack clone` | - |
| `stack add` | `--use`, `--region`, `--dryRun`, `--install` |
| `stack remove` | `--all`, `--allOrphans`, `--keepRemote`, `--json` |
| `stack list` | `--json` |
| `stack info` | `--json` |
| `stack status` | `--json` |
| `stack env` | `--env`, `--json` |
| `stack env show` | `--env`, `--json` |
| `stack env export` | `--example`, `--stdout`, `--force` |
| `stack env diff` | `--json` |
| `stack deps` | `--json` |
| `stack doctor` | `--fix`, `--all`, `--json`, `--ecosystem`, `--install`, `--apply`, `--repos`, `--reconcile` |
| `stack fleet-lanes` | `--json`, `--queue` |
| `stack fleet-supply` | `--json`, `--queue`, `--log` |
| `stack fleet-latency` | `--json` |
| `stack fleet-lag` | `--json` |
| `stack fleet-waste` | `--metrics`, `--hours`, `--json` |
| `stack fleet-reds` | `--json` |
| `stack fleet-silent` | `--runs`, `--json` |
| `stack fleet-collisions` | `--file`, `--json` |
| `stack fleet-delivery-lag` | `--fixture`, `--json` |
| `stack fleet-stuck` | `--json` |
| `stack fleet-slo` | `--json` |
| `stack fleet-act` | `--lane`, `--job`, `--slots`, `--message`, `--queue`, `--apply`, `--dryRun`, `--json` |
| `stack fleet-stream` | `--dispatch`, `--jobs`, `--follow`, `--sse`, `--port` |
| `stack fleet-graph` | `--json`, `--queue`, `--router` |
| `stack worktree-disk` | `--repo`, `--base`, `--json` |
| `stack fleet-gc` | `--json`, `--root`, `--runs`, `--queue`, `--reapIdleHours`, `--emptyIdleHours`, `--budgetSeconds`, `--ghBin`, `--lsofBin`, `--ghMax`, `--dryRun` |
| `stack fleet-bets` | `--json`, `--queue`, `--router`, `--ready`, `--metrics`, `--src` |
| `stack fleet-match` | `--json`, `--queue`, `--role`, `--capability`, `--tier`, `--job`, `--capabilitiesFile`, `--modelsFile` |
| `stack fleet-sheet-status` | `--runs`, `--sheet`, `--execution`, `--expect`, `--json` |
| `stack fleet` | `--json`, `--log`, `--queue` |
| `stack fleet slo` | `--json` |
| `stack fleet collisions` | `--file`, `--json` |
| `stack fleet waste` | `--metrics`, `--hours`, `--json` |
| `stack fleet sheet-status` | `--runs`, `--sheet`, `--execution`, `--expect`, `--json` |
| `stack exec` | `--as` |
| `stack swap` | `--dryRun`, `--noRollback`, `--keepFrom` |
| `stack sync` | `--platform` |
| `stack onboard` | `--apply`, `--undo`, `--client`, `--all`, `--home`, `--json` |
| `stack open` | - |
| `stack login` | - |
| `stack telemetry` | - |
| `stack telemetry status` | - |
| `stack telemetry enable` | - |
| `stack telemetry disable` | - |
| `stack templates` | `--json` |
| `stack templates list` | `--json` |
| `stack templates apply` | `--no-continueOnError` |
| `stack providers` | `--category`, `--json` |
| `stack recommend` | `--k`, `--category`, `--json`, `--save`, `--synth` |
| `stack apply` | `--noWire`, `--noRollback`, `--dryRun` |
| `stack projects` | `--json` |
| `stack projects list` | `--json` |
| `stack projects register` | - |
| `stack projects remove` | - |
| `stack projects where` | - |
| `stack ci` | `--json` |
| `stack ci init` | `--force`, `--json` |
| `stack completion` | - |
| `stack upgrade` | `--apply`, `-n`, `--dryRun`, `--json` |

## JSON output for agents

With `--json`, these commands print one JSON document on stdout, with no banners or colour. Each success document has a versioned `schema` field. Fields may be added within a version; existing ones never change meaning. Secret names appear, never values.

| Command | `schema` | Fields |
| --- | --- | --- |
| `stack list --json` | `ashlr.stack.list/v1` | `project_id`, `template`, `services[]` (`name`, `provider`, `resource_id`, `region`, `secrets[]`, `mcp`) |
| `stack status --json` | `ashlr.stack.status/v1` | `next_step` (`summary`, `command`), `config` (`present`, `project_id`, `template`), `phantom` (`installed`, `secret_count`, optional `secret_count_error`, `installed_error`), `services[]` (same as list) |
| `stack providers --json` | `ashlr.stack.providers/v1` | `category`, `total`, `providers[]` (`name`, `displayName`, `category`, `authKind`, `docs`), `unavailable[]` |
| `stack templates list --json` | `ashlr.stack.templates/v1` | `total`, `templates[]` (`name`, `services[]` with `name`, `provider`, `secrets[]`, `mcp`) |
| `stack projects list --json` | `ashlr.stack.projects/v1` | `total`, `projects[]` (`name`, `path`, `project_id`, `template`, `services[]`, `last_seen`) |
| `stack deps --json` | `ashlr.stack.deps/v1` | `project_id`, `template`, `categories[]` (`category`, `services[]`), `unresolved[]`, `totals` (`services`, `secrets`, `mcp`) |
| `stack info <service> --json` | `ashlr.stack.info/v1` | `service`, `provider`, `display_name`, `category`, `auth_kind`, `resource_id`, `region`, `created_at`, `created_by`, `docs`, `dashboard`, `mcp`, `meta`, `secrets[]` (`name`, `in_vault`), `health` |
| `stack env show --json` | `ashlr.stack.env/v1` | `env`, `services[]` (`name`, `secrets[]` with `name`, `in_vault`), `missing[]`, `orphans[]`, `totals` (`declared`, `in_vault`) |
| `stack env diff --json` | `ashlr.stack.env-diff/v1` | `ok`, `missing[]`, `totals` (`declared`, `missing`); exits 1 when any are missing |
| `stack import --json` | `ashlr.stack.import/v1` | `from`, `dry_run`, `phantom_installed`, `providers`, `unattributed`, `stored`, `skipped_existing`, `skipped_empty`, `services_added`, `services_kept` |
| `stack remove --json` | `ashlr.stack.remove/v1` | `mode`, `removed[]` (`service`, `secrets_removed[]`, `secrets_kept[]`, `mcp_removed`), `secrets_kept[]`, `upstream_kept`, `keep_remote` |
| `stack upgrade --json` | `ashlr.stack.upgrade/v1` | `package`, `current`, `latest`, `status` (`up_to_date`, `update_available`, `ahead` or `upgraded` after `--apply`), `install` (null after a successful upgrade or when no update is available) |
| `stack doctor --json` | `ashlr.stack.doctor/v1` | The shared `ashlr.doctor` wrapper (`kind`, `schema_version`, `version`, `tool`, `status`, `native_status`, `checks[]`) around the doctor report; see [docs/ashlr-handshake.md](docs/ashlr-handshake.md) |
| `stack list` or `stack status`, on failure | `ashlr.stack.error/v1` | `error` (message), exit code 1 |

Missing values are `null`. On failure, `stack list` and `stack status` print `ashlr.stack.error/v1`, and `stack doctor` prints its wrapper with `status: "fail"`. The other commands above print `{"error": "..."}` with no `schema` field and exit 1. So check for an `error` field first, then read `schema`. Other `--json` commands, such as `stack scan`, `stack recommend` and `stack onboard`, print JSON without a `schema` field.

`stack status --json` reads local configuration and probes Phantom installation and vault counts. Use `stack doctor --json` or `stack info <service> --json` for the available provider health checks. After `stack upgrade --apply --json` succeeds, `current` still names the version before the upgrade and `latest` names the installed version.

```bash
stack status --json | jq -r '.next_step.command'
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The command succeeded. |
| 1 | The command failed, including wrong or missing input. |
| 2 | Human `stack doctor --reconcile` found source drift; reserved also for items not found. |
| 3 | Reserved for an action that is not allowed. |
| 4 | Reserved for a service that is unavailable. |

Service-check failures from `stack doctor`, including `--json`, exit 1. `stack doctor --reconcile --json` exits 0 even when it reports drift; inspect `orphans`, `untracked`, and the wrapper's `status`. See [diagnostic examples](docs/examples.md#inspect-local-status-and-source-drift).

Existing commands may report different kinds of failure with code 1. `stack exec`
returns the wrapped command's exit code, or 128 plus the signal number if it
was stopped by a signal.

## MCP tools

Project-scoped tools take an absolute `cwd`. Catalog, registry, template, and upgrade tools reject `cwd`. The server can also list up to three resources when the files exist: `stack://current/.stack.toml`, `stack://current/.stack.local.toml`, and `stack://current/.mcp.json`.

<!-- fresh:begin tools-table -->
| Tool | CLI route |
| --- | --- |
| `stack_init` | `stack init` |
| `stack_import` | `stack import` |
| `stack_scan` | `stack scan` |
| `stack_add` | `stack add` |
| `stack_remove` | `stack remove` |
| `stack_list` | `stack list` |
| `stack_info` | `stack info` |
| `stack_status` | `stack status` |
| `stack_env_show` | `stack env show` |
| `stack_env_diff` | `stack env diff` |
| `stack_doctor` | `stack doctor` |
| `stack_sync` | `stack sync` |
| `stack_providers` | `stack providers` |
| `stack_projects_list` | `stack projects list` |
| `stack_deps` | `stack deps` |
| `stack_templates_list` | `stack templates list` |
| `stack_upgrade` | `stack upgrade` |
| `stack_recommend` | `stack recommend` |
| `stack_apply` | `stack apply` |
<!-- fresh:end -->

## Limits

Write commands (`stack add`, `stack apply`, `stack import`, `stack onboard --apply`) can contact a provider, store secrets, or edit agent config. Do not run them until the user has named the project and the provider. Check `phantom status --json` first. Writing flows stop when Phantom initialization is missing. Stack does not run `phantom init` for you.

`stack scan --auto` without `--yes` exits 1 in a non-interactive shell, because it would prompt. Use `stack scan --json` to detect services without writing.

Custom model host variables (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `OLLAMA_HOST`) and the rules for which URLs are allowed are in [docs/model-endpoints.md](docs/model-endpoints.md).

Release steps for maintainers are in [docs/RELEASE.md](docs/RELEASE.md).

## FAQ

**Does getting started need an account?**

No. The first command reads the bundled provider catalog. The four additional `npx` examples rank providers, scan the current directory, or list catalog entries and templates without configuring services.

**Where do secrets go?**

Selected persistent values go to Phantom Secrets. `.stack.toml` stores slot names and shape, not those values. `.stack.local.toml` is gitignored and holds per-clone ids. Stack still holds values in memory during setup, and CLI or MCP text can contain them. Do not paste command output into a public issue.

**Is `--json` on every command?**

No. It is declared per command. The start block and `stack onboard --json` are the quickstart forms. The root option also supports `stack --version --json`; put `--json` after a subcommand for that command's output.

**What if I stop using Stack?**

Provider resources and the Phantom vault stay where they are. Removing Stack does not turn vault references into a plaintext `.env`.

**Is this production secret management?**

No. Stack is pre-alpha. Evaluate Phantom on its own if you need a vault decision. Provider accounts and API usage can cost money even though the Stack license is MIT.

**How do I report a bug?**

Use [SUPPORT.md](SUPPORT.md). Security reports stay private: [SECURITY.md](SECURITY.md).

## Star Ashlr Stack

If this is the control plane you want agents to find, star the repo: [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack).

## Contributing

Issues and PRs are welcome. Look for [`good first issue`](https://github.com/ashlrai/ashlr-stack/labels/good%20first%20issue) to get started, and read [CONTRIBUTING.md](CONTRIBUTING.md). Its [agent path](CONTRIBUTING.md#contribute-with-an-agent) covers forking, the checks to run and what the required CI Gate check needs before a PR merges. For questions and bug reports, see [SUPPORT.md](SUPPORT.md). Report security problems privately per [SECURITY.md](SECURITY.md).

Ashlr Stack is one of the open-source tools from [Ashlr](https://ashlr.ai). See [Part of the Ashlr ecosystem](#part-of-the-ashlr-ecosystem) for the sibling tools. The site is [stack.ashlr.ai](https://stack.ashlr.ai).

## License

MIT.
