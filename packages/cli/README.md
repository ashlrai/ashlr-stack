# @ashlr/stack

> The `stack` CLI - configure supported services with Phantom-backed credentials and MCP wiring. Use `stack providers` to inspect your installed catalog.

Part of [Ashlr Stack](https://stack.ashlr.ai). See the monorepo at [ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack).

## What it is

`stack` offers template-assisted setup for selected supported services. For example:

```bash
stack init --template nextjs-supabase-posthog
```

Run from your application's directory. Stack writes configuration, uses provider-specific authentication, provisions where supported, and stores selected credentials through [Phantom Secrets](https://phm.dev/secrets). Vercel prompts for an existing personal access token. Setup does not generate application code or automatically write `.env`; `stack env export --example` separately writes an empty `KEY=` skeleton to `.env.example`.

Stack handles credentials in memory during setup. `.stack.toml` stores the service shape; per-developer IDs belong in the gitignored `.stack.local.toml`. Review project configuration and MCP output before sharing them; the CLI is not a general redaction boundary.

## Install

One-liner (recommended):

```bash
# macOS / Linux
curl -fsSL stack.ashlr.ai/install.sh | bash

# Windows (PowerShell)
irm https://stack.ashlr.ai/install.ps1 | iex
```

Or install manually from the registry:

```bash
npm i -g @ashlr/stack ashlr-stack-mcp
# or use Bun as the package manager
bun add -g @ashlr/stack ashlr-stack-mcp
```

Prerequisites:

- Node.js >= 20 for this npm package, including with `npx`; check your installed package manifest. Source development uses [Bun](https://bun.sh).
- [Phantom Secrets](https://phm.dev/secrets) - installed and initialized for the intended project before writing setup flows

Verify your installed `stack --version` and command `--help`; available commands depend on the installed version. Package installation does not establish provider acceptance.

## Quickstart

```bash
stack init                            # interactive template picker
stack add supabase                    # provider authentication → setup → vault/config/MCP
stack add                             # no arg = interactive provider picker
stack doctor                          # inspect the configured-service health report
stack doctor --all                    # run across every registered project
stack list                            # show this project's stack at a glance
stack providers                       # catalog registered in your installed release
```

Bring Stack to an existing repo:

```bash
stack scan                            # detect providers already in the code
stack scan --auto                     # scans, then runs `stack add` for each
stack import                          # inhale an existing .env into Phantom
stack clone https://github.com/your-org/your-repo       # clone + scan someone else's project
```

Run your app with secrets injected by Phantom:

```bash
stack exec -- bun dev
```

## Commands

A guide to common commands; check your installed version's help for availability:

| Command | What it does |
| --- | --- |
| `stack init [--template]` | Write Stack configuration in the current directory; optionally provision preset services |
| `stack add [service]` | Attempt provider-specific authentication, provisioning and selected secret/config/MCP writes; inspect partial results |
| `stack remove <service> [--json]` | Remove local MCP wiring and configuration and attempt vault removal (or use `--all`); JSON reports retained names in `secrets_kept`, and upstream resources are always retained |
| `stack list [--json]` | Show services wired into this project; `--json` prints `ashlr.stack.list/v1` |
| `stack info <service>` | Deep-dive on one service (resource, region, docs, MCP name) |
| `stack status [--json]` | Phantom, services and config at a glance; `--json` prints a stable report (schema `ashlr.stack.status/v1`, secret names only) |
| `stack doctor [--all] [--fix] [--json]` | Inspect health reports; `--fix` attempts supported repair, `--json` formats the report. Without `--all`, a directory with no `.stack.toml` is an error, not a healthy report |
| `stack scan [--auto]` | Detect providers from package manifests, configs, `.env.example` |
| `stack import [--from <file>]` | Migrate an existing `.env` into Phantom + `.stack.toml` |
| `stack clone <git-url> [dir]` | git-clone + scan + next-steps |
| `stack providers [--json]` | Browse your installed provider catalog; `--json` prints `ashlr.stack.providers/v1` |
| `stack templates list [--json]` | List starter provider presets; `--json` prints `ashlr.stack.templates/v1` with each template's services |
| `stack deps [--json]` | ASCII tree of this stack grouped by category; `--json` prints `ashlr.stack.deps/v1` |
| `stack env show` / `stack env diff` | Effective env-var surface vs vault vs config |
| `stack env export --example` | Write a separate `.env.example` with empty values; `--stdout` previews it |
| `stack exec -- <cmd>` | Forward to the installed `phantom exec` runtime |
| `stack projects list`, `stack projects register`, `stack projects remove <name>`, `stack projects where <name>` | Cross-project registry; `stack projects list --json` prints `ashlr.stack.projects/v1` |
| `stack ci init` | Inspect unavailable CI health workflow generation; exits nonzero without writing a workflow |
| `stack completion <bash\|zsh\|fish>` | Emit a shell-completion script |
| `stack upgrade` | Check npm for a newer release; `--apply` upgrades an npm global CLI with rollback |
| `stack login <provider>` | Refresh credentials for that provider; existing stored credentials are separate from setup staging |
| `stack sync --platform <name>` | Push through Phantom to a configured Vercel, Railway or Fly target |
| `stack onboard [--apply] [--undo]` | Detect Codex, Claude Code, Cursor and Gemini CLI and register the Phantom gateway (`ashlr-hub`) in each; plan only without `--apply`, existing config files backed up before writing; `--undo` restores them |

Full reference with flags, subcommands, and examples: **[stack.ashlr.ai/docs/cli](https://stack.ashlr.ai/docs/cli)**.

## MCP integration

Where supported, `stack add` writes a provider entry to the project's `.mcp.json`; client and provider setup still require verification. See [ashlr-stack-mcp](https://www.npmjs.com/package/ashlr-stack-mcp) for Stack's own server (19 declared tools and up to 3 project resources). Tools are a subset of CLI commands; use the advertised input schemas. Results contain CLI text and `isError`, not a universal structured JSON receipt or sandbox guarantee.

## Configuration

Stack splits config into two files:

- `.stack.toml` - **committed**. Service names, secret slots, MCP wirings.
- `.stack.local.toml` - **gitignored**. `project_id`, `resource_id`, timestamps. Unique per clone.

Teammates can inspect `stack doctor` and use `stack doctor --fix` for supported remediation. Existing vault names can skip repair; name presence is not credential validity or provider acceptance.

Full schema: [stack.ashlr.ai/docs/config](https://stack.ashlr.ai/docs/config).

## Safe CLI upgrades

`stack upgrade` checks for a newer stable release without installing it. For an
existing npm global installation on macOS or Linux, run `stack upgrade --apply`.
Use `--apply --dryRun` to preview, or add `--json` for machine-readable output.
Bun, linked development installs, Windows, and other ecosystem components are
outside this first upgrade slice; use the manual installation hint for those.

The command checks the current package identity and CLI health, installs the exact
new version into a temporary prefix with lifecycle scripts disabled, and checks
its version and help output. It then replaces the package directory while keeping
the existing launcher. If either active health check fails, it restores the original
directory locally and verifies it, without downloading the previous version.
Failures exit nonzero, including a successfully rolled back upgrade. Successful
`--apply --json` reports have status `upgraded`; read-only reports retain the
existing `ashlr.stack.upgrade/v1` shape.

An exclusive lock prevents overlapping Stack upgrades. Do not run another package
manager against the same installation during an upgrade. Each npm operation has
a two-minute timeout and each CLI health check has a fifteen-second timeout.
These checks cover CLI startup, version, and command registration, not remote
service health. No provider resources or credentials are changed.

A process kill or power loss between directory renames requires manual recovery.
Recovery files live beside the installed package under `.stack-upgrade-*`, with
the original package in `previous`. Keep those files until the installation is
verified. If automatic recovery fails, the error identifies the retained directory.
Only remove a stale `.stack-upgrade-lock` after confirming no upgrade is running
and restoring/verifying the installation.

## Part of the Ashlr ecosystem

The `stack` CLI is one tool in the [Ashlr ecosystem](https://github.com/ashlrai/ashlr-stack#part-of-the-ashlr-ecosystem). Together these tools aim to be an autonomous, code-first, agent-native software factory, chasing open-source RSI (recursive self-improvement). Agents do the work, and the human acts as a passive board member. Stack is the service layer, alongside Phantom (runs the agents), [Phantom Secrets](https://github.com/ashlrai/phantom-secrets) (vault), [Locus](https://github.com/ashlrai/locus) (identity plane), [Lexicon](https://github.com/ashlrai/lexicon) (voice lexicon), [Ashlr Markdown](https://github.com/ashlrai/ashlr-md) and the [Ashlr plugin](https://github.com/ashlrai/ashlr-plugin). `stack doctor --ecosystem` shows which of these are installed; it is read-only.

## Contributing

Coding agents maintain this package through pull requests in [ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack). Humans and agents follow the same [contributor path](https://github.com/ashlrai/ashlr-stack/blob/main/CONTRIBUTING.md#contribute-with-an-agent): fork, install, run the checks, open a PR, and merge through the merge queue once the required CI Gate check passes.

## Links

- Docs - [stack.ashlr.ai/docs](https://stack.ashlr.ai/docs)
- Quickstart - [stack.ashlr.ai/docs/quickstart](https://stack.ashlr.ai/docs/quickstart)
- Provider catalog - [stack.ashlr.ai/docs/providers](https://stack.ashlr.ai/docs/providers)
- Repo - [github.com/ashlrai/ashlr-stack](https://github.com/ashlrai/ashlr-stack)
- Issues - [github.com/ashlrai/ashlr-stack/issues](https://github.com/ashlrai/ashlr-stack/issues)

## License

MIT. See the repository [LICENSE](../../LICENSE).
