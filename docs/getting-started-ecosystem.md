# Getting started with the Ashlr tools together

This guide sets up four tools side by side: Phantom (`phm`), Locus (`locus`), Stack (`stack`) and the ashlr plugin. Each step was run on a Linux box (except `stack exec --as`, checked from `--help` only, since it needs a `.stack.toml`) on Oct 25 2026 with a throwaway `HOME`, or checked against `--help`. Where the published package lags the source, it says so.

## Version lag (check before you start)

| Tool | Published | Source (main) | Check |
|---|---|---|---|
| Phantom `@ashlr/phantom` | 3.29.15 | 3.29.15 | `npm view @ashlr/phantom version` |
| Locus `locus-cli` | 0.5.0 | 0.5.1 | `npm view locus-cli version` |
| Stack `@ashlr/stack` | 0.1.1 | 0.2.2 | `npm view @ashlr/stack version` |

Features that are in source but not in these published builds: `phm fleet receipt` (the published 3.29.15 answers `unknown fleet subcommand: receipt`), `--ashlr-handshake` on `phm`, `stack doctor --ecosystem` and `stack exec --as`. The locus 0.5.0 npm build has a known `locus --version` loop; see the locus README. To try the newer features, build from source as shown below.

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

The published 0.1.1 lacks the flags below, so use a source checkout:

```bash
git clone https://github.com/ashlrai/ashlr-stack && cd ashlr-stack
bun install
alias stack="bun run $(pwd)/packages/cli/src/index.ts"
stack --version                  # 0.2.2
stack doctor --ecosystem         # which Ashlr tools are installed, via --ashlr-handshake; informational, never fails
stack exec --as personal -- bun dev   # needs a .stack.toml (run `stack init` first); see `stack exec --help` for --as
```

`stack doctor --ecosystem` reports older installed tools as `installed, but too old to answer --ashlr-handshake`. That is expected for locus 0.5.0 and phantom-secrets 0.7.9.

## 4. ashlr plugin

Install for your host as described in the [ashlr-plugin README](https://github.com/ashlrai/ashlr-plugin#install) (Claude Code one-liner, or the Codex marketplace steps). From a source checkout you can run the doctor directly:

```bash
git clone https://github.com/ashlrai/ashlr-plugin && cd ashlr-plugin
bun install
bun run scripts/doctor.ts        # includes a `companions` section: phantom, phantom-secrets, locus
bun run scripts/cli.ts --help    # codex-doctor, codex-install --dry-run, tools, stats
```

The `companions` section says `not installed` or `too old for --ashlr-handshake` with a fix line for each tool. On a box without a host configured, the doctor also reports warnings and failures for the missing host setup.

## Where to go next

- Phantom and Locus with Stack: [phantom-locus.md](./phantom-locus.md)
- The handshake format: [ashlr-handshake.md](./ashlr-handshake.md)
