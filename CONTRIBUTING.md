# Contributing to Ashlr Stack

Thanks for poking around. Stack is early and the surface is intentionally curated — we want depth per provider, not breadth at any cost.

Stack is one tool in the [Ashlr ecosystem](README.md#part-of-the-ashlr-ecosystem). Most changes here come from coding agents (Phantom and others) that open and merge their own pull requests. Human contributions are just as welcome and go through the same checks. If you are an agent, read [AGENTS.md](AGENTS.md) and [STACK.md](STACK.md) first.

## Finding something to work on

New here? Start with the [good first issue](https://github.com/ashlrai/ashlr-stack/labels/good%20first%20issue) label. Issues also labeled [help wanted](https://github.com/ashlrai/ashlr-stack/labels/help%20wanted) are ones we would especially like a PR for.

- Comment on the issue before you start so two people do not do the same work.
- Keep the PR small and tied to one issue. Say in the description how you tested it.
- If you are unsure whether something belongs here, open an issue first and ask.
- Questions are welcome in issues. We read all of them.

## Contribute with an agent

Humans and agents follow the same path. Point your coding agent (Claude Code, Codex, Cursor) at this section, [AGENTS.md](AGENTS.md) and [STACK.md](STACK.md#agent-quickstart-from-a-clone), then let it work.

1. **Fork and clone.** Without write access to `ashlrai/ashlr-stack`, fork it on GitHub and clone your fork. Work on a branch, never on `main`.
2. **Install.** `bun install --frozen-lockfile`. A new git worktree starts without `node_modules`, so run it in each worktree too. Optionally run `bun run setup-hooks` once per clone to wire the pre-commit hook in `.githooks/`, which runs `bunx biome check .`.
3. **Run the checks your change touches.** Both helpers compare against `origin/main`, so `git fetch origin` first (in a fork, sync your fork's `main` with upstream).
   - `bash scripts/fast-check.sh` typechecks and tests each workspace under `packages/` that differs from `origin/main`, including uncommitted and untracked files. It prints one `PASS` or `FAIL` line per step and exits 1 on any failure. It skips changes outside `packages/`, such as `scripts/` or docs.
   - `scripts/affected-tests origin/main` prints a JSON array of test targets, `[]`, or `ALL` for the committed changes since `origin/main` (commit first; it ignores uncommitted work). Pass the array elements to `bun test`, run plain `bun test` for `ALL`, and skip tests for `[]`. Details: [scripts/affected-tests.md](scripts/affected-tests.md).
4. **Run the checks the PR gate runs** (see below), plus `bun run lint`.
5. **Sync generated docs.** If you touched a version, manifest, `CHANGELOG.md`, command, MCP tool or provider, run `bun run fresh:sync` then `bun run fresh:check`. New CLI commands and MCP tools have extra steps in [STACK.md](STACK.md#typical-tasks).
6. **Add a changelog entry** for a user-visible change, under `## Unreleased` in the root `CHANGELOG.md`. The site copy at `packages/site/src/data/CHANGELOG.md` must stay byte-identical, so re-mirror it with `bun run --cwd packages/site sync-content` and commit both ([docs/changelog-format.md](docs/changelog-format.md)). Parallel agent bridge PRs skip both files and put the entry in `BRIDGE_NOTES.md` at the worktree root instead, per [AGENTS.md](AGENTS.md#hot-files-bridge-prs-carry-changelog-entries-in-the-notes).
7. **Open a PR** from your branch with the template filled in: what changed, why, and how you tested it. One concern per PR.
8. **Merge.** PRs land through GitHub's merge queue once the required check passes. Turning on auto-merge (`gh pr merge --auto`) needs write access; for a PR from a fork, a maintainer or fleet agent turns it on.

### What CI requires

The one required check is **CI Gate** in `.github/workflows/ci.yml`. On a pull request and in the merge queue it needs these jobs to pass:

| Job | What it runs |
| --- | --- |
| Typecheck + Tier-1 security tests | `bunx tsc --noEmit -p tsconfig.json`, `bun test packages/core/src/__tests__/security.test.ts packages/core/src/__tests__/secret-redaction.test.ts`, `bun run check:crypto` |
| Secret scan (diff) | Pinned Gitleaks over the commits the PR adds |
| Secret-shape scan | The pinned `scrub.pl` over the added lines of the diff |

The full suite (the Bun test matrix, the site build with `astro check`, and Biome lint) runs daily on `main` and on manual dispatch, not on each PR. A red daily run opens a FIX-MAIN issue and agents fix `main` forward. Run the full suite locally before you open anything large, so your change does not turn the daily run red.

Never commit secret values. Use Phantom Secrets placeholders in examples and fixtures; the two secret scans fail closed.

## Dev loop

```bash
bun install --frozen-lockfile
HOME=$(mktemp -d) bun test                   # full suite, isolated home
bunx tsc --noEmit -p tsconfig.json          # typecheck
bun run lint                                # biome check .
bun run packages/cli/src/index.ts providers # smoke CLI
```

No build step for the CLI — Bun runs `.ts` directly.

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
