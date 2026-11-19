# Getting started with the Ashlr tools together

The Ashlr ecosystem has seven tools. Together they aim to be an autonomous, code-first, agent-native software factory, chasing open-source RSI (recursive self-improvement): agents do the work, and the human acts as a passive board member. Stack is the service layer. Coding agents maintain each repo through pull requests; the rules for this one are in [AGENTS.md](../AGENTS.md).

This guide sets up the tools side by side. Phantom (`phm`), Locus (`locus`), Stack (`stack`) and the ashlr plugin each have a walkthrough. Each step was run on a Linux box (except `stack exec --as`, checked from `--help` only, since it needs a `.stack.toml`) on Oct 25 2026 with a throwaway `HOME`, or checked against `--help`. Where the published package lags the source, it says so. Phantom Secrets, Lexicon and Ashlr Markdown have short install sections taken from Stack's own install plan and fix hints in the source.

## The seven tools

`stack doctor --ecosystem` probes each command in the second column with `--ashlr-handshake --json` (source: `packages/cli/src/lib/ecosystem.ts`). The install column is what Stack's install plan (`packages/cli/src/lib/doctor-install.ts`) or its fix hint suggests.

| Tool | Command | Install | Role |
|---|---|---|---|
| Phantom `@ashlr/phantom` | `phm` | `npm install -g @ashlr/phantom` (Node.js 22.15+) | Runs the agents that improve these repos, for example `phm improve`. |
| [Phantom Secrets](https://github.com/ashlrai/phantom-secrets) | `phantom` | `brew install ashlrai/phantom/phantom` | Vault. Stack stores the secrets you select here. |
| [Locus](https://github.com/ashlrai/locus) | `locus` | From source with cargo while npm 0.5.0 is broken | Identity plane. Pins which account a session acts as. |
| [Lexicon](https://github.com/ashlrai/lexicon) | `lexicon` | `npm install -g @ashlr/lexicon` (Node.js 20+) | Voice lexicon. Keeps dictated names spelled right. |
| [Ashlr Markdown](https://github.com/ashlrai/ashlr-md) | `mdopener-mcp` | Desktop app from the [ashlr-md releases](https://github.com/ashlrai/ashlr-md/releases) (manual) | Desktop Markdown app with an MCP server. |
| [ashlr plugin](https://github.com/ashlrai/ashlr-plugin) | `ashlr-plugin` | Per host, from the [plugin README](https://github.com/ashlrai/ashlr-plugin#install) | Plugin for Claude Code and Codex. |
| Ashlr Stack (this repo) | `stack` | `npm i -g @ashlr/stack` (Node.js 20+) | Configures services and wires them into agents. |

`stack doctor --ecosystem --install` prints the install commands for missing tools in a safe order and runs nothing; see [Install what is missing](#install-what-is-missing).

## Recorded versions (check before you start)

| Tool | Published | Reviewed source | Check |
|---|---|---|---|
| Phantom `@ashlr/phantom` | 3.29.15 | 3.29.15 | `npm view @ashlr/phantom version` |
| Locus `locus-cli` | 0.5.0 | 0.5.1 | `npm view locus-cli version` |
| Stack `@ashlr/stack` | 0.3.10 | <!-- fresh:begin version-pin -->0.3.10<!-- fresh:end --> | `npm view @ashlr/stack version` |
| Stack MCP `ashlr-stack-mcp` | 0.3.10 | <!-- fresh:begin version-pin -->0.3.10<!-- fresh:end --> | `npm view ashlr-stack-mcp version` |

The Stack publication rows were last checked against the npm registry on November 16, 2026 (0.3.10, each package declaring Node.js 20 or newer); the deeper archive, provenance and consumer verification below covers 0.3.6. The other tool rows and walkthrough observations remain historical; check their current registry versions and installed help before setup.

The Phantom observations below are from the October 25 run: `phm fleet receipt` (the published 3.29.15 answered `unknown fleet subcommand: receipt`) and `--ashlr-handshake` on `phm` were not in that build. The locus 0.5.0 npm build has a known `locus --version` loop; see the locus README. To try the newer features, build from source as shown below.

## 1. Phantom

```bash
npm install -g @ashlr/phantom   # Node.js 22.15+ and Git
phm --version                   # 3.29.15
phm doctor                      # pass / warn / fail table; a fresh install shows warnings and suggests `ashlr onboard`
phm help                        # topics; `phm help <topic>` for one table
```

## 2. Locus (identity plane)

From source (0.5.1):

```bash
git clone https://github.com/ashlrai/locus && cd locus
cargo install --path crates/locus-cli
```

`stack doctor --ecosystem --install locus` prints the equivalent `cargo install --git` command, pinned to a reviewed locus commit.

First run, in this order:

```bash
locus quickstart                 # sample bindings personal and acme, mints a control capability, runs doctor
eval "$(locus hook bash)"        # export the control capability in this shell (needed in every new shell)
locus enter personal             # pin a binding for this session
locus whoami
locus exec --expect personal -- echo ok   # runs: the pinned binding is personal
locus exec --expect acme -- echo ok       # refused, exit 1, child never starts: pin_mismatch
locus doctor --fix               # preview safe repairs, writes nothing; add --apply to make them
```

Notes from the run:

- Without the `eval "$(locus hook bash)"` line, `locus exec` fails with `LOCUS_CONTROL_CAPABILITY is required`.
- Run `locus enter <alias>` before `locus exec`. If `exec` says `human re-pin required`, the recovery it prints works: `locus leave --force`, then `locus enter personal`.
- The sample bindings have no tokens, so `exec` warns `unresolved credential, child runs without it` and still runs the child. Add `--strict-creds` to fail instead.

## 3. Stack

Registry check, November 16, 2026: npm serves 0.3.10 for `@ashlr/stack-core`, `@ashlr/stack` and `ashlr-stack-mcp`, each declaring Node.js 20 or newer. The deeper verification of November 6, 2026 below covers 0.3.6 only: the public npm archives for `@ashlr/stack-core`, `@ashlr/stack`, and `ashlr-stack-mcp` are version 0.3.6 and identify source `0009a742d83d7f25761e1f9bc33739aca8dfbda5`. Their archive integrity and release provenance were verified. The published 0.3.6 CLI and MCP manifests declare Node.js 20 or newer. The [GitHub v0.3.6 release](https://github.com/ashlrai/ashlr-stack/releases/tag/v0.3.6) provides four macOS/Linux arm64/x64 binaries and four checksum sidecars. Actual Node.js 22 CLI and MCP initialization/tool-list checks passed for the published packages, with MCP protocol versions `2025-06-18` and `2025-03-26`; the Mac arm64 native version and handshake checks also passed. These checks do not establish Linux native execution on this Mac or provider acceptance. Source and published versions describe separate artifacts; verify current registry versions and installed help.

To run the source checkout (which uses Bun):

```bash
git clone https://github.com/ashlrai/ashlr-stack && cd ashlr-stack
bun install
alias stack="bun run $(pwd)/packages/cli/src/index.ts"
stack --version                  # check the source checkout version
stack doctor --ecosystem         # which Ashlr tools are installed, via --ashlr-handshake; informational, never fails
stack exec --as personal -- bun dev   # needs a .stack.toml (run `stack init` first); see `stack exec --help` for --as
```

`stack doctor --ecosystem` reports older installed tools as `installed, but too old to answer --ashlr-handshake`. That is expected for locus 0.5.0 and phantom-secrets 0.7.9.

Run `stack doctor --ecosystem --json` for the same report in JSON. The `schema` is
`ashlr.stack.doctor/v1`; `version` identifies the Stack CLI. Each `ecosystem` entry
has an `installed` boolean and one `fix` object (`summary`, `command`), or `null`
when no fix is suggested. Missing tools show the same fix in terminal output.

## 4. ashlr plugin

Install for your host as described in the [ashlr-plugin README](https://github.com/ashlrai/ashlr-plugin#install) (Claude Code one-liner, or the Codex marketplace steps). From a source checkout you can run the doctor directly:

```bash
git clone https://github.com/ashlrai/ashlr-plugin && cd ashlr-plugin
bun install
bun run scripts/doctor.ts        # includes a `companions` section: phantom, phantom-secrets, locus
bun run scripts/cli.ts --help    # codex-doctor, codex-install --dry-run, tools, stats
```

The `companions` section says `not installed` or `too old for --ashlr-handshake` with a fix line for each tool. On a box without a host configured, the doctor also reports warnings and failures for the missing host setup.

## 5. Phantom Secrets (vault)

Every `stack add` records the secrets you select through the `phantom` CLI. When `phantom` is missing, `stack doctor --ecosystem` suggests:

```bash
brew install ashlrai/phantom/phantom
```

The [install script](https://stack.ashlr.ai/install.sh) (`curl -fsSL stack.ashlr.ai/install.sh | bash`) tries the same Homebrew tap when `phantom` is missing and falls back to the one-liner from [phm.dev](https://phm.dev). How Stack calls the vault is in [phantom-locus.md](./phantom-locus.md) and [phantom-process.md](./phantom-process.md).

## 6. Lexicon (voice lexicon)

```bash
npm install -g @ashlr/lexicon    # Node.js 20+; the step Stack's install plan runs for lexicon
lexicon doctor --fix             # preview repairs, writes nothing; see Repair everything below
```

## 7. Ashlr Markdown

Ashlr Markdown is a desktop app with the `mdopener-mcp` sidecar. Stack does not install it; its install plan prints a manual step that points to the [ashlr-md releases](https://github.com/ashlrai/ashlr-md/releases) and the repo's `docs/INSTALL.md`. Once installed, `mdopener-mcp doctor --fix` previews repairs.

## Install what is missing

```bash
stack doctor --ecosystem --install                 # prints the commands, in order; installs nothing
stack doctor --ecosystem --install --apply phantom,lexicon   # runs them for the named tools only
```

The order follows the first-run measurements: Node 22.15+ is checked first, then phantom, locus (from source with cargo while npm 0.5.0 is broken), lexicon and the ashlr-md desktop app (a manual step), with `phm doctor` last. That `phm doctor` exits 1 while optional companions such as locus or a local model are missing, and Stack counts that as expected. Phantom Secrets and the ashlr plugin are not in this plan; they install through their own hosts (sections 4 and 5). The historical npm 0.1.1 build did not provide `stack onboard`.

## Repair everything

One command previews the repairs every installed tool offers. It runs each tool's own `doctor --fix --json` (only for tools whose handshake advertises the `doctor-fix` capability) and changes nothing:

```bash
stack doctor --ecosystem --fix   # available in this 0.3.10 source checkout; absent from the historical 0.1.1 build
```

Then make the repairs with each tool's own command. Run them yourself, directly in your shell:

| Tool | Preview (writes nothing) | Apply | Notes from the run |
|---|---|---|---|
| Locus | `locus doctor --fix` | `locus doctor --fix --apply` | Backs up each changed file first (`.bak-<timestamp>`). Needs the control capability in the shell (`eval "$(locus hook bash)"`). |
| Lexicon | `lexicon doctor --fix` | `lexicon doctor --fix --apply` | Backs up each file first; exit 1 if a repair was skipped. `--apply` without `--fix` exits 1. Example fix: creates a missing global lexicon. |
| ashlr-md | `mdopener-mcp doctor --fix` | `mdopener-mcp doctor --fix --apply` | Owner-only permissions on `~/.mdopener`, moves aside corrupt saved reviews (contents backed up first); exit 1 if a repair was skipped. `--apply` without `--fix` exits 2. Never touches `ipc-token`. |

Run Locus repairs directly, not through Stack. Stack's `--apply <tools>` does not pass Locus's control capability to the child, so a Locus repair that needs it is refused there; `locus doctor --fix --apply` in your own shell works. The previews exit 0 whether or not there is something to fix.

Checked on Oct 25 2026 from source (locus 0.5.1, lexicon 0.5.6, mdopener-mcp 0.4.0) in a throwaway `HOME`.

## Where to go next

- Phantom and Locus with Stack: [phantom-locus.md](./phantom-locus.md)
- The handshake format: [ashlr-handshake.md](./ashlr-handshake.md)
- Every repository doc, by topic: [docs/README.md](./README.md)
