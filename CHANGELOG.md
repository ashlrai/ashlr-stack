# Changelog

## Unreleased

### Round 9: usage errors an agent can act on

- **An option before the subcommand is refused.** `stack --json list` passed the unknown-option guard, because the root declares `--json` for `stack --version`, and citty never hands a subcommand the options typed before its name: `list` printed the human error and `stack env --json show` the human report. An option before a subcommand name now exits 1. When the subcommand takes it, the message says where it goes (`Option --json goes after the subcommand: run \`stack list --json\``); otherwise it is an unknown option for that subcommand (`stack -v list`). With `--json` on the line the message is also `{"error": ...}` on stdout.
- **A missing argument under `--json` is a JSON error.** `stack info --json` with no service printed the usage text on stdout, so an agent parsing it got no JSON. A usage error that citty raises (a missing required positional) now prints `{"error": "Missing required positional argument: SERVICE. Run \`stack info --help\` for usage."}` on stdout and the same line on stderr when `--json` is on the line (exit 1). Without `--json` the usage text is unchanged.
- **`stack add <typo>` outside a project says the provider is unknown.** It checked for `.stack.toml` first, so `stack add supabse` answered "Run `stack init` first." and only after init said the provider did not exist. The provider name (and a missing name without a terminal) is now checked before the project, and a name within two edits of a real provider ends with `Did you mean supabase? Run \`stack add supabase\`.`
- **`stack recommend db --k -1` names the value.** citty reads `-1` after `--k` as a short option, so the message said `Invalid --k with no value`. It now says `Invalid --k "-1"`, as `--k=-1` already did.
- **`stack onboard --client <unknown>` exits 1.** It exited 2, unlike every other usage error, and printed nothing on stdout with `--json`. It now exits 1 and, with `--json`, prints `{"error": "Unknown client: ..."}`. `stack onboard --undo --json` with nothing to undo prints the same kind of error object.
- **MCP: `stack_status` takes `cwd`.** It reads `.stack.toml` in its working directory like the other project-scoped tools, but refused `cwd`, so a server started outside the project could only report `.stack.toml missing`. It now accepts the same optional absolute `cwd` (`packages/mcp/README.md`).

### Silent acceptance

- **Extra arguments exit 1 instead of being dropped.** citty keeps only the positionals a command declares and drops the rest, so `stack recommend build a saas` searched for "build" alone, `stack add supabase neon` added only supabase, and `stack providers nope` listed every provider with exit 0. A positional with no slot now exits 1 with `Unexpected argument "a" for \`stack recommend\`, which takes <query>. Quote a value that contains spaces, or run the command once per value.` (`{"error": ...}` on stdout with `--json`). Values of options such as `--region us-east-1` are not counted. (`packages/cli/src/lib/unknown-flags.ts`)
- **Unknown CLI options exit 1 instead of being ignored.** citty parses options a command does not declare and never complains, so `stack list --jsn` printed the human list with exit 0, `stack upgrade --json` printed its banner, and `stack --bogus` printed the welcome banner. Every command now refuses an option it does not declare, names the closest real one (`Did you mean --json?`) and points at its `--help`; with `--json` on the line the message is also `{"error": ...}` on stdout. Everything after `--`, `stack exec`'s forwarded command, `--no-<flag>` negation and negative numbers are left alone. Bare `stack env`, `stack templates` and `stack projects` now declare the options of the subcommand they run (`show`, `list`, `list`). A test checks that every argv the MCP server builds passes the guard. (`packages/cli/src/lib/unknown-flags.ts`)
- **`stack scan` without a terminal prints its report.** It printed only a "no TTY detected" hint and exited 0, so an agent got neither results nor an error. Plain `stack scan` now prints the same read-only report (detections and `stack add` next steps, nothing written); `stack scan --auto` without `--yes` exits 1, since it would ask before each add.
- **MCP: `stack_recommend {"k": 0}` is no longer the default of 6.** A zero `k` was dropped as falsy and a negative one reached the CLI as a flag (`Invalid --k with no value`). Every `k` is now passed as `--k=<n>`, so the CLI rejects 0, negatives and fractions by value.
- **MCP: blank strings are rejected.** `stack_info {"service":"  "}` ran `stack info "  "` and `stack_sync {"platform":" "}` ran the sync check with a blank platform. A whitespace-only value now counts as missing for a required argument and is an error for an optional one.

### Output and usage order

- **`stack env export --stdout` prints only the skeleton.** The `stack env export` banner and a `printed to stdout.` outro went to stdout too, so `stack env export --stdout > .env.example` wrote them into the file.
- **Bare `stack exec` says a command is missing.** It checked for `.stack.toml` and Phantom first, so with no command it answered "Run `stack init` first." or the Phantom install hint. It now says `Nothing to run. Usage: stack exec -- <command>` before anything else (exit 1).

### MCP project targeting

- **Project-scoped MCP tools take an optional `cwd`.** The server always ran `stack` in its own working directory and no tool took a project argument, so a host that starts the server outside the project (Claude Desktop, a global Cursor config) could not reach it: `stack_list` answered "No .stack.toml at <server dir>". `stack_init`, `stack_import`, `stack_scan`, `stack_add`, `stack_remove`, `stack_list`, `stack_info`, `stack_status`, `stack_env_show`, `stack_env_diff`, `stack_doctor`, `stack_sync`, `stack_deps`, `stack_recommend` and `stack_apply` now accept `cwd`, an absolute path to an existing directory, and run `stack` there. It is resolved with realpath; a relative path, a missing path or a file is refused with an `isError` result before anything runs. Global tools (`stack_providers`, `stack_projects_list`, `stack_templates_list`, `stack_upgrade`) refuse `cwd` with their own message rather than silently ignoring it or answering "unknown argument". Resources still read the server's working directory.

### Agent dead ends

- **`stack ci` refuses with one actionable line instead of printing help.** Bare `stack ci` printed usage and `No command specified` with exit 1, and its only subcommand `init` is intentionally unavailable (the old workflow needed unattended Phantom Cloud pull, which requires trusted-terminal approval). `stack ci` and `stack ci init` now say what to run instead (`stack doctor` from a trusted terminal, or `stack doctor --reconcile --json` in CI) and exit 1. With `--json` they print `{"error": ...}` on stdout. No workflow is ever written.
- **`stack swap` reports an unknown provider before the Phantom check.** A typo such as `stack swap clerkk auth0` on a machine without Phantom printed the Phantom install hint. Provider names, the category match and the `.stack.toml` entry are now validated first, as in `stack add`.

### Agent-facing output

- **`stack login <provider>` without a terminal says what a person must do.** It stopped at "no valid key in vault and session is non-interactive"; it now gives the same hint as `stack add`, naming `stack login <provider>` as the command to run in the user's own terminal (exit 1).
- **`stack templates list --json` and `stack projects list --json`.** Both ignored `--json` and printed the human banner. They now print one JSON object with no banner: `ashlr.stack.templates/v1` (each template's name and the services it adds) and `ashlr.stack.projects/v1` (each registered project's name, path, project id, template, services and last-seen time). Bare `stack templates --json` and `stack projects --json` print the same reports. The `stack_templates_list` and `stack_projects_list` MCP tools take `json: true`.
- **MCP tools reject argument names they do not declare.** A misspelled key was dropped and the tool ran without it, so `stack_recommend {"query":"db","catgory":"Database"}` returned an unfiltered result as a success. Unknown keys are now an `isError` result that lists the accepted arguments.
- **An unknown template names where to find the real ones.** `stack templates apply <name>` and `stack init --template <name>` now say to run `stack templates list`.
- **`llms-full.txt` lists the `json` input on `stack_info` and `stack_env_show`.** The agent reference still showed `{ service: string }` and `{}` after those tools gained `json: true`.
- **The last lines of a failing command reach a pipe on Bun 1.2.** `outroError` exits the process, and Bun 1.2 dropped stdout still queued at exit, so a piped `stack apply` lost its final `Some providers failed: ...` line, `stack doctor` with many services lost most of its report, and an MCP `stack_add` returned only "Failed." The CLI now writes stdout and stderr synchronously under Bun, as Node already does for pipes, so nothing is pending when it exits.
- **`stack doctor` with no services says so.** A `.stack.toml` with no services printed "All services healthy."; it now prints "No services to check" and how to add one (exit 0).
- **`stack_add` without a terminal says what a person must do.** A provider that needs a pasted key or a browser sign-in failed over MCP with "no valid key in vault and session is non-interactive" (or "No valid Neon API key in vault."). The error now says the session has no terminal and to ask the user to run `stack add <provider>` in their own terminal.
- **`stack info <service> --json` and `stack env show --json`.** One JSON object on stdout with no banner: `ashlr.stack.info/v1` (provider, resource, secret names with `in_vault`, MCP entry, healthcheck result) and `ashlr.stack.env/v1` (secret names per service with `in_vault`, plus `missing` and `orphans`). Values are never printed. A missing project or service prints `{"error": ...}` and exits 1. The `stack_info` and `stack_env_show` MCP tools take `json: true`.

### Vendor-neutral MCP wiring

- **Stack mirrors MCP entries into Cursor and Gemini CLI project configs.** When `.cursor/` or `.gemini/` already exists in the project, `stack add` also writes the server into `.cursor/mcp.json` and `.gemini/settings.json` (Gemini's `httpUrl`/`url` naming, no `type`), and `stack remove` takes it out again. Absent client dirs are never created, other keys and servers are preserved, and an unparseable client file is left untouched without failing the add. A same-name entry the user wrote by hand in one of those files is never replaced, and `stack remove` (or a rolled-back `stack add`) deletes a client entry only when it still matches what Stack mirrored from `.mcp.json`.

### Agent onboarding

- **`stack onboard` detects Codex, Claude Code, Cursor and Gemini CLI and registers the Phantom gateway (`ashlr-hub`, `ashlr mcp`) in each.** It prints a plan by default and writes nothing. `--apply` saves a timestamped backup of each existing config, adds only the `ashlr-hub` entry, keeps every other key, and re-checks each client afterwards. An existing `ashlr-hub` entry that differs is never overwritten. `--undo` restores the saved files byte for byte and refuses any file that changed since it was written. `--client`, `--all` (include clients that are not detected), `--home` and `--json` are supported. It never touches the network or a vendor CLI and writes no secret values.

### Machine-readable output

- **`stack list --json`, `stack providers --json` and `stack deps --json`.** These commands accepted `--json` but ignored it and printed human text with exit 0, so agents could not parse them. Each now prints one JSON object on stdout with no banner or ANSI: `ashlr.stack.list/v1` (project id, template, and each service with provider, resource id, region, secret names and MCP entry), `ashlr.stack.providers/v1` (every registered provider with category, auth kind and docs URL, plus any that failed to load), and `ashlr.stack.deps/v1` (services grouped by category, services whose provider is not registered, and totals). Without a `.stack.toml`, `list --json` and `deps --json` print `{"error": ...}` and exit 1. Human output is unchanged. The `stack_list`, `stack_providers` and `stack_deps` MCP tools take `json: true` for the same output.
- **`stack projects list --json` and `stack templates list --json`.** Both ignored `--json` and printed the decorated human list, so the `stack_projects_list` and `stack_templates_list` MCP tools returned banner text an agent had to scrape. They now print one JSON object: `ashlr.stack.projects/v1` (each registered project with name, path, project id, template, service names and last-seen time) and `ashlr.stack.templates/v1` (each template with its services, providers, secret names and MCP entry). Bare `stack projects --json` and `stack templates --json` do the same. Both MCP tools take `json: true`.

### Usage errors exit non-zero

- **`stack recommend` with no query, or a bad `--k`, exits 1.** No query (or a blank one, as `stack_recommend {"query":"   "}` sends) printed "nothing to recommend" with exit 0, and `--k abc`, `--k 0` or `--k 2.5` were silently replaced by the default of 6. Both now exit 1; `--json` still prints the "Provide a query" payload on stdout, and a bad `--k` names the value on stderr.
- **`stack remove <name>` and `stack open <name>` name the configured services.** An unknown name only said "<name> is not in this stack."; it now lists what is configured, suggests a case-only match ("Did you mean openai?"), or says the stack has no services and to run `stack add <provider>`.
- **`stack projects remove` only reports what it removed.** Any argument starting with `/` printed "Removed ... from registry." with exit 0, even when no project was registered there, and a relative path such as `.` was never matched. It now matches a registered name first, then the argument as a path from the current directory, and exits 1 with a pointer to `stack projects list` when nothing matched. `unregisterProject()` in `@ashlr/stack-core` now returns whether it removed an entry.

### Install fixes

- **Packed npm tarballs include their bins.** `@ashlr/stack` and `ashlr-stack-mcp` built `dist/` only in `prepublishOnly`, which `npm pack` skips, so a packed tarball had no `dist/` and installing it gave no `stack` or `ashlr-stack-mcp` command. The build now runs in `prepack`, which both `npm pack` and `npm publish` run.
- **Installers state the real provider count (39, not 23)**, and `release-artifacts.test.ts` checks it against the registry and that the site serves the same `install.sh`/`install.ps1` as `scripts/`.
- **`install.sh` says how to get the MCP server after a binary install.** The prebuilt release binary is only `stack`; the installer now prints `npm i -g ashlr-stack-mcp` / `npx -y ashlr-stack-mcp`, and the MCP README no longer says the one-liner always installs both.

### Bug fixes

- **`stack exec` no longer reports a killed command as success.** A wrapped command terminated by a signal (OOM kill, `kill -9`) left the exit code null and `stack exec` exited 0. It now exits 128 + the signal number (137 for SIGKILL) and says which signal. SIGINT, SIGTERM and SIGHUP sent to `stack exec` itself (an agent timeout, a supervisor) are forwarded to the wrapped command instead of killing only the wrapper and leaving the command running.
- **One Ctrl-C reaches a command run by `stack exec` once.** On a terminal, Ctrl-C and hangup already go to the wrapped command (it shares the terminal's process group), and `stack exec` relayed them a second time, so tools that treat a second interrupt as "exit immediately" (terraform's "Two interrupts received") skipped their graceful shutdown. On a terminal `stack exec` now relays only SIGTERM and waits for the command; off a terminal (an agent or supervisor) it still relays SIGINT, SIGTERM and SIGHUP.
- **MCP tools check their input before running the CLI.** A missing required argument reached the CLI as the literal string `undefined` (`stack_add {}` ran `stack add undefined`), and a value starting with `-` was parsed as a flag: `stack_remove {"service":"--all"}` ran `stack remove --all` and targeted every service instead of one. The server now returns an error naming the argument for a missing required field, a wrong type, or a leading `-`, and runs nothing.
- **`stack apply` with a missing recipe writes nothing.** In a directory without `.stack.toml`, `stack apply <id>` for an id that does not exist (or bare `stack apply` with no recipes) auto-ran `stack init` first, leaving `.stack.toml`, `.stack.local.toml`, `.gitignore` and a `~/.stack/projects.json` entry behind before failing. The recipe is now resolved first.
- **`stack apply` and `stack init --template` keep going after a provider fails.** A failed `stack add` exited the process, so later providers never ran, the partial-failure rollback never happened and no summary was printed. Every provider is now tried, each failure is printed, and the run ends with `Some providers failed: <name>: <reason>; ...` and exit 1. A wrong recipe id now also lists the saved ids or says to run `stack recommend "..." --save`.

## 0.2.1 (2026-10-16)

0.2.1 was never published, so everything below ships in it, along with the 2026-10-12 notes further down. Source versions (core, cli, mcp, `server.json`, `VERSION` in `packages/cli/src/index.ts`) are already 0.2.1, which `scripts/publish.sh` checks before it publishes core, then cli, then mcp.

### Setup and release safety

- **Credentials are staged during setup.** New login credentials are written only after materialization succeeds, ordinary inputs are validated before commit, and create-only Phantom refusals no longer strand Stack state. (#26, #28)
- **Release inputs and downstream jobs are guarded.** The release workflow refuses the legacy `npm_otp` input and checks that a tag run publishes the tagged commit. (#38)
- **CLI fixtures run on the Bun 1.2 floor.** (#27)

### Site

- Homepage wrapping, FAQ clipping, ecosystem examples and the Mechanics tab were corrected, and agent-facing claims now match real CLI behavior. (#32, #34, #35, #36, #37)

### Docs

- **Adding a provider** — [docs/adding-a-provider.md](docs/adding-a-provider.md) lists every file a new provider touches, and `provider-parity.test.ts` fails when the loader registry, the catalog and `docs/provider-auth-matrix.md` disagree (#18).

### Bug fixes

- **`stack apply` stops writing placeholder secrets.** Its wiring step ran `phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`) for every declared secret. Phantom Secrets refuses values in argv and has no `--rotate`, so every call failed and the printed `envelopes` count was always 0; on an older Phantom it could store `TODO_STACK_APPLY` and block the real value later. Apply now reads names from `phantom list --json` and prints `secrets in vault N · missing M · webhooks K`, plus a `not in Phantom:` line pointing at `phantom add <NAME>`. It never writes to the vault. `WireResult.envelopes` is replaced by `present` and `missing`. (Successor to #33.)

- **Command errors are one line.** A command that fails outside a Stack project (`stack list`, `deps`, `info`, `remove`, ...) now prints `✗ No .stack.toml at <path>. Run \`stack init\` first.` on stderr and exits 1, instead of a stack trace followed by the same message again. `STACK_DEBUG=1` adds the stack. Usage errors still print usage. (`packages/cli/src/lib/run-cli.ts`, #19)

- **CI workflow generation fails closed.** `stack ci init` now exits nonzero without creating or overwriting a workflow because the reviewed Phantom Secrets 0.7.9 source requires trusted-terminal approval for Cloud pull. Existing configuration and file guards remain; `--force` stays available as a compatibility flag and does not enable generation.

- **Stack works with Phantom Secrets 0.7.9.** Phantom 0.7.3+ rejects `phantom add KEY VALUE` (argv is visible to other processes), never replaces a stored name, and only reveals or removes a secret in an attached terminal. Stack still passed values on argv, so every `stack add` failed against the released CLI, and `phantom list`'s table was parsed as secret names. Stack now pipes values to `phantom add KEY --stdin`, treats a repeat of its own identical write as done, reports any other existing name as `PHANTOM_SECRET_EXISTS`, reads names from `phantom list --json`, and has `stack remove` hand Phantom the terminal (or list the secrets Phantom kept). Reading a stored token back is no longer possible, so cached-token reuse falls back to prompting, and token-based healthchecks could not read the token (see the `stack doctor` fix below). `packages/core/src/__tests__/phantom-contract.test.ts` runs the wrapper against a real binary (`STACK_PHANTOM_CONTRACT_BIN=/path/to/phantom bun test phantom-contract`).

- **`stack doctor` no longer calls a stored token missing.** Phantom Secrets 0.7.9 only reveals values in an attached terminal, so every token-based healthcheck reported `<TOKEN> missing from vault` and failed even when the token was stored. Doctor now checks names against `phantom list --json`: a token Phantom holds but would not reveal reports `unchecked` with a pointer to `phantom validate --check-all`, and only a name absent from the vault still fails as missing.

### Agent-facing fixes

- **`npx -y ashlr-stack-mcp` can run tools.** The MCP server spawned `stack` from PATH (absent under npx, and Haskell's `stack` when present). `ashlr-stack-mcp` now depends on `@ashlr/stack` and runs that package's bin with the current runtime; `STACK_BIN` still overrides, PATH is the last resort. Publish order is now core, cli, mcp. (`packages/mcp/src/stack-bin.ts`)
- **`stack status --json` for agents and Phantom.** It prints one `ashlr.stack.status/v1` object: whether a `.stack.toml` exists, whether Phantom is installed and how many secrets it holds, and each service with its provider and secret names. A missing `.stack.toml` or Phantom is reported in the object with exit 0; an unreadable `.stack.toml` prints `{"error": ...}` and exits 1. Before, Phantom parsed the human table and listed zero services. The `stack_status` MCP tool takes `json: true` for the same output. The secret count is `null` when the vault cannot be read, and `stack info` shows `? unknown` instead of calling every secret missing.
- **`stack_scan` over MCP returns results.** It now always passes `--json`; before, every call answered "no TTY detected".
- **`stack recommend --category` matches any case.** `--category database` used to return no hits, because the filter compared against `Database` exactly. An unknown category now exits 1 and lists the valid ones, instead of returning an empty result.
- **`stack sync` rejects an unknown platform first.** `stack sync --platform heroku` said "Unsupported platform" only after checking for Phantom. The `stack_sync` MCP schema now names the supported platforms, and the docs quote the error the MCP server actually sends when it can't run the CLI.
- **No spinner escape codes in piped output.** `prompts.spinner()` prints plain lines when stdout is not a TTY or `CI` is set, so MCP results and CI logs stay clean. (`packages/cli/src/ui.ts`)
- **`stack exec` stdout belongs to the command.** The intro banner is gone and errors go to stderr, so `stack exec -- cmd > out.json` captures only `cmd`.
- **MCP `serverInfo.version` reads package.json** instead of a hard-coded `0.2.0`.
- **Bare `stack env` / `stack templates` / `stack projects` / `stack telemetry`** run `show` / `list` / `list` / `status` instead of exiting 1 with "No command specified".
- **`stack add <typo>` names the unknown provider first.** It used to demand Phantom before checking the name, so a misspelled provider on a machine without Phantom only said "Phantom Secrets isn't installed".
- **Release + docs name the MCP package correctly** (`ashlr-stack-mcp`, not `@ashlr/stack-mcp`), including the site's MCP setup snippet.
- **CI smoke-tests the npm bundles under Node 20** (`stack --help`, MCP initialize, tools/list, `stack_scan`) via `scripts/node-smoke.mjs`.

### Earlier 0.2.1 notes (2026-10-12)

- **Release workflow repaired.** A multi-line `git commit -m` in the Homebrew job ended the YAML block early and left a stray top-level key, so GitHub rejected `release.yml` on every push and the v0.2.0 npm publish never ran.
- **Docs: Phantom Secrets + Locus.** New `docs/phantom-locus.md` explains how Stack stores keys through Phantom and runs provider CLIs inside a Locus-pinned account (personal / company / client).

### Bug fixes

- **Kebab-case flags now parse (`--dry-run`, `--keep-from`, `--all-orphans`, …)** — citty 0.1.6 silently dropped the documented kebab spelling of multi-word flags: a boolean arg with `default: false` shadowed the kebab-parsed value, so `--dry-run` was ignored while only `--dryRun` worked. For `stack add` this was high-severity — the documented "safe preview" form fell through to the **real** provisioning flow (live OAuth/network/vault writes). Raw argv is now normalized (`--dry-run` → `--dryRun`) before parsing, fixing every command at once while preserving camelCase, `--no-*` negation, and `--` passthrough. (`packages/cli/src/lib/normalize-args.ts`)
- **`stack add` no longer hangs on interactive credential entry** — the CLI started a @clack spinner, then a provider's PAT/key-paste path wrote its prompt to stderr and blocked on stdin while the spinner repainted over the (now invisible) prompt. With no cached credential — e.g. a fresh repo — `stack add` appeared to hang forever. The host now owns prompting: a new `ProviderContext.prompt` plus a `spinnerBridge` helper pause the spinner around a masked @clack prompt, and all nine interactive providers route credential entry through a shared `promptSecret`. GitHub's device-code message goes through `ctx.log` for the same reason. (`packages/core/src/providers/_helpers.ts`, `packages/cli/src/ui.ts`)

### SEO + GEO content surface (major)

- **29 programmatic provider pages** — new dynamic route at `/providers/[slug]` driven by `packages/core/src/catalog.ts`. Adding a provider to catalog auto-mints a page at build time. Each page: hero with brand logo, auth-flow explainer, secret-slot breakdown, MCP wiring status, `stack add` snippet, `stack recommend` trigger, related providers, templates that include it, FAQ, outbound dashboard + docs links. JSON-LD: TechArticle + BreadcrumbList + FAQPage.
- **4 hand-authored competitor comparison pages** — `/compare/stack-vs-pulumi`, `/compare/stack-vs-terraform`, `/compare/stack-vs-railway`, `/compare/stack-vs-doppler`. Each ~1100 words with TL;DR, 10-row HTML comparison table, honest "where each wins" sections, "can I use both?", 3-question FAQ with FAQPage JSON-LD. Sidebar nav updated with a new "Comparisons" group.
- **Sitemap** now indexes 51 URLs (up from 18) — every new page is discoverable by Google/Bing/Perplexity crawlers out of the gate.

### GEO drift reconciliation (critical)

- **Canonical counts unified** — one number per surface. 29 providers · 19 MCP tools · 5 templates. Previously README said "27", llms.txt said "23", mcp.json claimed 18 where other surfaces claimed 19, FAQ said 26. LLM training pipelines distrust inconsistent sources; fixing this is the highest-value GEO move we had available.
- **3 missing adapters added to `packages/core/src/catalog.ts`**: Braintrust, Modal, Replicate. The providers had executable adapters but weren't in the canonical catalog, so `stack recommend` didn't know about them and their counts drifted.
- **Disambiguation block** added to `llms.txt` + `llms-full.txt`: "Ashlr Stack is not Stack Overflow / Stacks blockchain / stack.js / stack.com / Pulumi or Terraform 'stack'." Explicit anti-confusion for LLM training.
- **Version + date stamps** added to `llms.txt` + `llms-full.txt` headers: `Version: 0.1.1 · Updated: April 2026`. LLM corpora prefer fresh sources.
- **`structured-data.ts`** now imports from `PROVIDERS_REF` (core catalog) so the `SoftwareApplication` JSON-LD count is derived, not hardcoded. `softwareVersion: "0.1.0-pre-alpha"` → `"0.1.1"`.
- **Hero stat strip** now derives from `PROVIDERS_REF.length` (29, canonical) instead of the site's 39-entry display list.
- **Homepage BreadcrumbList JSON-LD** added for SERP rich-result eligibility.
- **`ai-plugin.json` `description_for_model`** provider list now includes Modal, Replicate, Braintrust, SendGrid, Mailgun, Postmark.

### Tech SEO micro-fixes

- **`HeroIntroOverlay`**: `client:load` → `client:idle`. No longer blocks LCP on first paint.

### Hero "Generate a stack" demo (from earlier tonight)

- Clickable in-hero animation that plays a realistic `stack recommend → stack apply` loop with six real provider chips (Supabase, Vercel, Anthropic, PostHog, Sentry, GitHub) materializing then stamping ✓, ending with a summary line. Six seconds from click to "oh, I get it." Honors `prefers-reduced-motion` by snapping to the final frame.
  - `packages/site/src/components/GenerateStackDemo.tsx` (new, 220 lines, zero new deps)
  - Wired into `Hero.astro` under the copy-pasteable prompt block so the value prop ladder reads: *one line you tell Claude → what happens when you click play*.

## [0.2.0] — 2026-04-23

### Added

- Compiled node-compatible CLI bin (`dist/index.js`); `npm install -g @ashlr/stack` now works without bun on the host.
- `stack init --template` runs the full provisioning pipeline for every template service via a shared `lib/provision-loop.ts` helper; `--noProvision` preserves shape-only behavior.
- `stack add` detects the project's package manager and prompts to install the provider's SDKs after persist; `--install={ask,always,never}` overrides.
- 10 new provider adapters: Auth0, WorkOS, Mixpanel, Plausible, Datadog, Grafana, GCP, DigitalOcean, Hetzner, LaunchDarkly. Adds Observability and FeatureFlags categories. Catalog now 39 providers.
- `stack scan --yes --json --confidence` flags for headless CI adoption.
- `stack doctor --reconcile` flags configured services no longer referenced in source.
- `stack remove --all-orphans` cleans up services present in config but absent from source.
- Transactional rollback on `stack add` failure; optional `Provider.deprovision` implemented for supabase, neon, turso, vercel.
- `stack env export --example` writes a committable `.env.example` from catalog secret keys (never values).
- `stack swap <from> <to>` with 38 preset pairs across six categories; env-key aliases preserve variable names across equivalent providers (e.g. `DATABASE_URL` on supabase↔neon).
- `stack telemetry {status,enable,disable}` — opt-in anonymous usage telemetry, default off; `STACK_TELEMETRY=0` always honored.
- Update notifier checks npm once per 24 h (`~/.ashlr/stack/update-check.json`); respects `STACK_NO_UPDATE_CHECK` and `CI`.
- MCP server smoke tests: spawn `dist/server.js`, send `tools/list`, assert schemas.
- Pre-commit hook via `bun run setup-hooks`; CI lint flipped from advisory to blocking after a biome `--write` pass.
- Site CLI reference auto-generated at prebuild from citty metadata (`scripts/gen-cli-ref.ts`), removing 581 lines of hand-synced mirror.
- `SECURITY.md` with GitHub Security Advisory disclosure path and 7-day triage commitment.
- `CODE_OF_CONDUCT.md` in plain language with confidential enforcement channel.
- `docs/PRIVACY.md` documenting every telemetry field collected, three opt-out paths, and retention policy.

### Changed

- Tests: 186 → 315 passing, 0 failing.
- Typecheck clean across core, cli, mcp; biome clean on 177 files.

### Fixed

- Rollback error now surfaces both the original failure and any teardown failure when `Provider.deprovision` throws, so callers know whether a dangling upstream resource was left behind.
- `stack swap X X` rejected up front with a clear message instead of falling through to `SERVICE_ALREADY_ADDED`.

## 0.1.1 — 2026-04-19

First fully-published release: binaries on GitHub Releases, npm scope claimed, all three packages live.

- **npm**: `@ashlr/stack-core`, `ashlr-stack-mcp`, `@ashlr/stack` all published to the registry under the new `@ashlr` org.
- **Binaries**: darwin arm64/x64 + linux arm64/x64 on https://github.com/ashlrai/ashlr-stack/releases/tag/v0.1.1, all cross-compiled on `macos-latest` (the macos-13 Intel runner queue was killing us).
- **`install.sh`**: now resolves a real release. `curl -fsSL https://stack.ashlr.ai/install.sh | bash` is the canonical install path.
- Same feature surface as the 0.1.0 tag (below); 0.1.0 shipped a GitHub Release + binaries but no npm packages, so v0.1.1 is what users should pin.

## 0.1.0 — 2026-04-19 (superseded by 0.1.1)

Initial tag. Binaries for macOS (arm64 + x64) and Linux (arm64 + x64) on GitHub Releases; `install.sh` one-liner. npm publish deferred to 0.1.1.

### AI recommendation layer — `stack recommend` + `stack apply`

Stack is now agent-native from day one. Describe what you're building; Stack picks the providers, drafts a reproducible Recipe, and hands it to either Claude Code (via MCP) or the local-SLM fallback for synthesis.

- **`stack recommend [query]`** — free-text → top providers ranked by a zero-dep BM25 + IDF scorer over the curated catalog. Flags: `--json`, `--k`, `--category`, `--save`, `--synth`. `--save` freezes the result to `.stack/recipes/<id>.toml` so the user can follow up with `stack apply <id>`. `--synth` calls the local SLM for model-authored rationales and falls back silently when no endpoint is reachable.
- **`stack apply [recipe-id]`** — re-runs the existing `stack add` pipeline for every provider in the Recipe, then wires [Phantom](https://phm.dev) rotating envelopes + webhook stubs (Stripe, Clerk, Supabase, GitHub). Default ON; `--noWire` opts out. Interactive `@clack/prompts` picker when no id is given.
- **MCP surface** — `stack_recommend` (with `save:true`) and `stack_apply` exposed so Claude can drive the full loop from a coding session. Retrieval-only on the MCP path by design — Claude owns the reasoning, Stack owns the catalog + execution.
- **Canonical catalog** — moved from `packages/site/src/lib/providers-ref.ts` into `packages/core/src/catalog.ts`; site now re-exports the shim. One source of truth for CLI, MCP, AI, and docs.
- **Local SLM backend** — `packages/core/src/ai/inference.ts` talks OpenAI-compatible HTTP to LM Studio (`localhost:1234`) with Ollama fallback (`localhost:11434`). Circuit breaker + cost tracker copied from the ashlrcode router pattern. Zero new npm deps, no OpenAI/Anthropic SDKs in the Stack repo — the user's LLM keys belong to Claude, not to us.
- **Site surface** — `packages/site/src/pages/api/recommend.ts` Edge-ready API route. StackBuilder gains a "Describe your project" textarea that pre-selects provider cards. StackREPL simulates `stack recommend` client-side.
- **Tests** — 179 pass / 0 fail (up from 135 before the AI layer). New: `catalog-index.test.ts`, `inference.test.ts`, `circuit-breaker.test.ts`, `recipe.test.ts`, `phantom-wire.test.ts`, `recommend.test.ts` (+ round-trip --save/apply).
- **CLI fix**: parent `run()` no longer trails a banner after every subcommand — was breaking machine-readable output (`stack providers`, `stack recommend --json`). Detects subcommand via `process.argv[2]`.

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
