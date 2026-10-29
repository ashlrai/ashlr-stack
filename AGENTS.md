# AGENTS.md: agent constitution

This repository is part of the AshlrAI ecosystem. It is maintained by Phantom (`phm improve` / steward) and other coding agents, under the same standing authority that applies to `ashlrai/phantom` (see phantom `docs/STANDING-AUTHORITY.md`).

## Agents may
- Create branches, commit, and open pull requests.
- Turn on GitHub auto-merge (`phm improve --auto-merge` / `gh pr merge --auto`). A PR merges only after every required CI check is green. Never bypass a failing or pending check, and never use an admin override.
- Fix CI, tests, docs, and dependencies, and iterate on review feedback.

## Reserved for Mason (owner approval required)
- Creating, moving, or deleting release tags, and publishing packages or releases.
- Rotating, creating, or exposing secrets and tokens.
- Deleting repositories, branches, or data, and changing rulesets or branch protection.
- Spending money, or anything that is billed.
- Outside messages: emails, posts, issues, or comments directed at people outside AshlrAI.

## Getting started
Build, test and run instructions for agents are in [STACK.md](./STACK.md#agent-quickstart-from-a-clone).

## Docs freshness

- Marked `<!-- fresh:begin name -->` ... `<!-- fresh:end -->` blocks in `README.md`, `STACK.md`, `CHANGELOG.md`, `docs/` and `templates/` are generated from the sources of truth: `package.json` versions, the latest released CHANGELOG section, the CLI registry (`packages/cli/src/index.ts` plus each command's `meta.description`), the MCP tool catalog (`packages/mcp/src/tools.ts`) and the provider registry (`packages/core/src/providers/index.ts` plus each provider's `category`).
- After touching a version, manifest, `CHANGELOG.md`, command, tool or provider source, run `bun run fresh:sync` then `bun run fresh:check` (drift exits 1). Block types and usage: [scripts/freshness/README.md](./scripts/freshness/README.md). Tests: `bun run fresh:test`.
- `HOME=$(mktemp -d) bun test scripts/docs-freshness.test.ts` cross-checks the generated tables and counts against the TypeScript source (AST plus runtime dispatch) and verifies documented commands and flags exist.
- Source capabilities do not establish published package versions or provider readiness. Verify installed command help, such as `stack onboard --help`, before using release-specific examples.

## Ground rules
- Keep diffs small and reviewable, with one concern per PR.
- Never commit secrets. Use Phantom Secrets placeholders.
- Never force-push to the default branch.
