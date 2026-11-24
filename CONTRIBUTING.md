# Contributing to Ashlr Stack

Thanks for poking around. Stack is early and the surface is intentionally curated — we want depth per provider, not breadth at any cost.

Stack is one tool in the [Ashlr ecosystem](README.md#part-of-the-ashlr-ecosystem). Most changes here come from coding agents (Phantom and others) that open and merge their own pull requests. Human contributions are just as welcome and go through the same checks. If you are an agent, read [AGENTS.md](AGENTS.md) and [STACK.md](STACK.md) first.

## Chat

Questions and working sessions happen in [The Dev Shack](https://discord.gg/jBQrSU6XeD) on Discord.

## Set up

From a clone, on macOS or Linux:

```bash
bash scripts/setup.sh
```

The script does not prompt, and running it again is safe. It checks that the system is macOS or Linux, installs Bun when `bun` is not on `PATH`, requires Node.js 20 or newer, runs `bun install --frozen-lockfile`, and smoke-tests `stack providers --json` from this checkout. A Dev Container runs the same script when the container is created (`.devcontainer/devcontainer.json`).

## Tests

After setup, run the full suite in a throwaway home:

```bash
HOME=$(mktemp -d) bun test
```

Typecheck with `bunx tsc --noEmit -p tsconfig.json`. Lint with `bun run lint`. The required pull request check is CI Gate. Its commands are under [Run the gate locally](#run-the-gate-locally). The [Dev loop](#dev-loop) lists the everyday commands.

## Finding something to work on

New here? Start with the [good first issue](https://github.com/ashlrai/ashlr-stack/labels/good%20first%20issue) label. Issues also labeled [help wanted](https://github.com/ashlrai/ashlr-stack/labels/help%20wanted) are ones we would especially like a PR for.

- Comment on the issue before you start so two people do not do the same work.
- Keep the PR small and tied to one issue. Say in the description how you tested it.
- If you are unsure whether something belongs here, open an issue first and ask.
- Questions are welcome in issues. We read all of them.
- Everyone, human or agent, follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Pull request flow

1. Fork `ashlrai/ashlr-stack` if you do not have write access, then clone your fork.
2. Create a branch. Do not commit on `main`.
3. Open a pull request against `main`. Say what changed, why, and how you tested it.
4. Wait until CI Gate is green. That is the required check.
5. The pull request merges through GitHub's merge queue. The queue runs CI Gate again on the latest `main` and squash-merges.

[Contribute with an agent](#contribute-with-an-agent) is the same path with the commands written out.

## Contribute with an agent

Humans and agents follow the same path. Point your coding agent (Claude Code, Codex, Cursor) at this section, [AGENTS.md](AGENTS.md) and [STACK.md](STACK.md#agent-quickstart-from-a-clone), then let it work.

**You need** git, [Bun](https://bun.sh) and Node.js 20 or newer. The required CI Gate pins Bun 1.4.4; the daily full suite also runs Bun 1.2.0 and the latest release. Node is needed because `bun run check:crypto`, `bun run fresh:sync`, `bun run fresh:check` and the release smoke scripts run under `node`. To run the two secret scans locally you also need Perl and, optionally, [Gitleaks](https://github.com/gitleaks/gitleaks).

1. **Fork and clone.** Without write access to `ashlrai/ashlr-stack`, fork it on GitHub and clone your fork. Work on a branch, never on `main`.
2. **Install.** `bash scripts/setup.sh` (or `bun install --frozen-lockfile` on its own). A new git worktree starts without `node_modules`, so run it in each worktree too. Optionally run `bun run setup-hooks` once per clone to wire the pre-commit hook in `.githooks/`, which runs `bunx biome check .`.
3. **Run the checks your change touches.** Both helpers compare against `origin/main`, so `git fetch origin` first. In a fork, `origin` is your fork, so bring its `main` up to date with `ashlrai/ashlr-stack` first, or the helpers and the [gate commands](#run-the-gate-locally) compare against a stale base:

     ```bash
     git remote add upstream https://github.com/ashlrai/ashlr-stack.git   # once per clone
     git fetch upstream && git push origin upstream/main:main && git fetch origin
     ```

     The push only fast-forwards your fork's `main` and is refused if that `main` has commits of its own, which it should not, since you work on a branch.
   - `bash scripts/fast-check.sh` typechecks and tests each workspace under `packages/` that differs from `origin/main`, including uncommitted and untracked files. It prints a `PASS` or `FAIL` line per step, shows the output of a failed step, and exits 1 on any failure. Treat it as a quick first pass: it tests only the packages that changed, but the core, CLI, MCP and site tests read each other's sources, so a core change can break a CLI or site test that it never runs. It compares with the tip of `origin/main`, so a branch that is behind also gets the packages changed upstream. It skips changes outside `packages/`, such as `scripts/` or docs, and changes to `packages/plugin`, which has no `package.json`.
   - `scripts/affected-tests origin/main` prints a JSON array of test targets, `[]`, or `ALL` for the committed changes since `origin/main` (commit first; it ignores uncommitted work). A change under core, CLI, MCP, site or plugin selects the tests of the four product packages (core, CLI, MCP and site), so this is the list to run before a PR. Pass the array elements to `bun test` and run plain `bun test` for `ALL`. For `[]`, skip `bun test`: with no arguments it runs the whole suite. If the script exits nonzero (an unknown base or missing merge history), it prints nothing; fetch and retry, or run the full suite, but never read that as "no tests". Details: [scripts/affected-tests.md](scripts/affected-tests.md).
   - Doc-only changes (root `*.md` and `*.txt` files, Markdown and text under `docs/`, package READMEs and licenses) print `[]`, yet many tests read those files and CI Gate runs none of them. Run `bun run fresh:check` and `HOME=$(mktemp -d) bun test scripts/docs-freshness.test.ts`, which checks the commands, flags, counts and generated tables in the docs against the source. More than 100 test files also read a specific doc by name, so run the tests that name each doc you changed. This lists them for the committed changes since `origin/main`; pass the paths it prints to `bun test` (prefix each with `./`), and skip `bun test` if it prints nothing:

     ```bash
     for f in $(git diff --name-only origin/main...HEAD); do git grep -l -F "$(basename "$f")" -- '*.test.ts'; done | sort -u
     ```

     A common name such as `README.md` selects many tests; that is expected. If you change the README's [Get started](README.md#get-started) commands or its commands table, also run `bun test packages/cli/src/__tests__/first-run-readme.test.ts`. It rebuilds `packages/cli/dist`, runs `stack providers`, `stack recommend` and `stack scan` against the built CLI in an empty directory with an empty home, checks that every command in the table prints its `--help` page, and fails if a registered command is missing from the table. Before opening a larger docs PR, run the full suite (`HOME=$(mktemp -d) bun test`) so the daily run stays green.
4. **Run the checks the PR gate runs** ([commands below](#run-the-gate-locally)), plus `bun run lint`.
5. **Sync generated docs.** If you touched a version, manifest, `CHANGELOG.md`, command, MCP tool or provider, run `bun run fresh:sync` then `bun run fresh:check`. New CLI commands and MCP tools have extra steps in [STACK.md](STACK.md#typical-tasks).
6. **Add a changelog entry** for a user-visible change, under `## Unreleased` in the root `CHANGELOG.md`. The site copy at `packages/site/src/data/CHANGELOG.md` must stay byte-identical, so re-mirror it with `bun run --cwd packages/site sync-content` and commit both ([docs/changelog-format.md](docs/changelog-format.md)). Agent PRs follow the same rule: `Unreleased` only, never released sections or versions ([AGENTS.md](AGENTS.md#changelog)).
7. **Push and open a PR.** Push your branch to your fork with plain `git push`, then open a PR against `main` of `ashlrai/ashlr-stack` with the template filled in: what changed, why, and how you tested it. One concern per PR. Do not run `scripts/publish.sh`. It is the npm release script that the release workflow runs; it publishes packages and pushes a tag. It is not the fleet's fork-push `publish.sh` that [AGENTS.md](AGENTS.md) names.
8. **Merge.** PRs land through GitHub's merge queue once the required check passes. Turning on auto-merge (`gh pr merge --auto`) needs write access; for a PR from a fork, a maintainer or fleet agent turns it on. What to expect:
   - **First PR from a fork.** GitHub holds Actions runs for first-time contributors until a maintainer approves them, so CI Gate shows as waiting, not failed. Once a PR of yours has merged, your runs start on their own.
   - **No approving review is required.** The `main` ruleset needs a pull request and a passing CI Gate, nothing more. Reviewers may still comment; reply in the thread or push a fix.
   - **No rebase needed.** Your branch does not have to be up to date with `main`. The merge queue tests your change on top of the latest `main` (CI Gate runs again there) and squash-merges it. If that run fails, the PR leaves the queue; push a fix and it can be queued again.

### What CI requires

The one required check is **CI Gate** in `.github/workflows/ci.yml`. On a pull request and in the merge queue it needs these jobs to pass:

| Job | What it runs |
| --- | --- |
| Typecheck + Tier-1 security tests | `bunx tsc --noEmit -p tsconfig.json`, `bun test packages/core/src/__tests__/security.test.ts packages/core/src/__tests__/secret-redaction.test.ts`, `bun run check:crypto` |
| Secret scan (diff) | Pinned Gitleaks over the commits the PR adds |
| Secret-shape scan | The pinned `scrub.pl` over the added lines of the diff |

On a pull request the checks list also shows the full-suite jobs (the Bun test matrix, the site build and Lint) as skipped. That is expected: CI Gate accepts those three as skipped on pull requests and in the merge queue, and fails if any other job does not pass. No other workflow runs on a pull request; CodeQL, coverage and Scorecard run on `main`.

The full suite (the Bun test matrix, the site build with `astro check`, and Biome lint) runs daily on `main` and on manual dispatch, not on each PR. A red daily run opens a FIX-MAIN issue and agents fix `main` forward. Run the full suite locally before you open anything large, so your change does not turn the daily run red. Its commands are in [STACK.md](STACK.md#commands-the-ci-expects-to-pass).

Never commit secret values. Use Phantom Secrets placeholders in examples and fixtures; the two secret scans fail closed.

### Run the gate locally

Commit your work first, then run from the repo root. These are the commands the gate jobs run, with the PR's base replaced by `origin/main`:

```bash
bunx tsc --noEmit -p tsconfig.json
bun test packages/core/src/__tests__/security.test.ts packages/core/src/__tests__/secret-redaction.test.ts
bun run check:crypto
git diff --no-color --no-ext-diff "$(git merge-base origin/main HEAD)" HEAD \
  | perl .github/tests/secret-shape/scrub.pl --check --allow-fixtures
gitleaks git . --log-opts="origin/main..HEAD" --redact --no-banner   # CI pins Gitleaks 8.30.0
```

`scrub.pl --check` prints counts, never the matched values, and exits 1 on any blocked match. `--allow-fixtures` lets a token through only when both hold: the file is a test path (under `test/`, `tests/`, `fixtures/`, `benches/` or `examples/`, or named `*.test.*`, `*.spec.*` or `*_test.*`), and the token contains `FAKE`, `EXAMPLE`, `DUMMY`, `TEST` or `XXXX`. Private key blocks are never allowed. CI deletes any `.gitleaks.toml` or `.gitleaksignore` before Gitleaks runs, so a PR cannot allowlist its own finding.

## Dev loop

```bash
bun install --frozen-lockfile
HOME=$(mktemp -d) bun test                   # full suite, isolated home
bunx tsc --noEmit -p tsconfig.json          # typecheck
bun run lint                                # biome check .
bun run packages/cli/src/index.ts providers # smoke CLI
```

Running the CLI from source needs no build step, since Bun runs `.ts` directly. Some tests do run the built bundles, which are gitignored. `packages/mcp/__tests__/server.test.ts` drives `packages/mcp/dist/server.js` and `packages/cli/dist/index.js` and builds them only when they are missing, so a bundle left over from older source can fail it. After you change CLI or MCP source, rebuild both with `bun run --cwd packages/cli build && bun run --cwd packages/mcp build` before you trust an MCP test failure. `packages/cli/src/__tests__/first-run-readme.test.ts` rebuilds `packages/cli/dist` itself. Root `bun run build` also builds the site, which rewrites tracked generated files.

## Adding a provider

Step-by-step guide with every file to touch: [docs/adding-a-provider.md](./docs/adding-a-provider.md).

Every curated provider implements `Provider` (`packages/core/src/providers/_base.ts`):

- `login(ctx)` — obtain and verify the adapter's auth inputs. Use `_api-key.ts`'s `makeApiKeyProvider` factory for its supported supplied-input flows, or `oauth.ts`'s `runPkceFlow` for an implemented OAuth path. Auth0 currently checks a domain's discovery response rather than authenticating an account.
- `provision(ctx, auth, opts)` — either create a new upstream resource or attach via `opts.existingResourceId`.
- `materialize(ctx, resource, auth)` — return `{ secrets, mcp?, urls? }`. The pipeline handles values in memory and attempts persistence through Phantom; failures can leave partial state.
- `healthcheck?(ctx, entry)` — optional ping; surfaced by `stack doctor`.
- `dashboardUrl?(entry)` — optional; wired into `stack open`.
- `deprovision?(ctx, auth, resourceId)` — optional; lets `stack add` attempt cleanup of a resource it created when a later step fails (implemented for Supabase, Neon, Turso, and Vercel). Attached resources do not acquire deletion authority; failed or unconfirmed cleanup must stay explicit.

Then register it in `packages/core/src/providers/index.ts` and `packages/core/src/catalog.ts`, add detection rules to `detect.ts` and `detect-source.ts`, add a row to `docs/provider-auth-matrix.md` and bump its header count. Test it (an API-key provider adds a spec to `SPECS` in `api-key-providers.test.ts`; any other kind gets its own fetch-mocked `<name>-provider.test.ts`), and add its landing-page entry in `packages/site/src/lib/providers.ts`. Other provider counts are generated: run `bun run fresh:sync`, `bun run --cwd packages/site gen:cli-ref` and the site build rather than editing them by hand. The [guide](./docs/adding-a-provider.md) has each step.

## Coding principles

- **Compose, don't duplicate.** Shell out to Phantom for every secret read/write. Never build a second vault.
- **No hard dependencies on @clack in core.** The CLI is the only package allowed to touch the prompts library.
- **Define meaningful checks.** `healthcheck` is optional; describe what it verifies and what remains unchecked. A passing limited probe is not full account or application acceptance.
- **Use named credential slots.** Canonical service entries reference dedicated secret names. Freeform metadata, overrides and manually edited config are not a general secret-redaction boundary.

## Scope

What Stack v1 is not:

- A secrets manager (that's Phantom).
- A deployment platform (that's Railway/Vercel/Fly).
- A token-efficiency layer (that's ashlr-plugin).
- An identity plane that picks which account a session acts as (that's Locus; `stack exec --as` defers to it).

Stack is the orchestration layer that stitches those together for the common "spin up a new project" flow.
