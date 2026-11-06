# AGENTS.md: agent constitution

This repository is part of the AshlrAI ecosystem. It is maintained by Phantom (`phm improve` / steward) and other coding agents, under the same standing authority that applies to `ashlrai/phantom` (see phantom `docs/STANDING-AUTHORITY.md`).

## Article 1: Full autonomy, always forward

Synced from the Ashlr Fleet Constitution v3.0 (Nov 1, 2026). This overrides any older text in this file.

**Full autonomy, always forward (Mason t1287u, Nov 1 2026 11:47 PM ET).** Every agent may merge PRs to main and push to production (releases through each repo's sanctioned workflow, any agent may dispatch them). Take the human out of the loop; let nothing slow us down; do the highest-leverage, most ambitious work. No approval, manual-merge, wait-for-per-PR-CI or ask-Mason steps. Mason is needed only for passwords, 2FA, device approvals and payments. The only kept limits are Security GATES v3, the hold list below, and making private things public. Any new gate must be justified against this article or it is rejected.

### Hard floor (the only fixed rules)
- Security GATES v3: pins only on the secret gate (scrub.pl, secret-shape gate, publish.sh), sandbox profiles and leader wrappers/prompts/plists, secret-leaking workflow diffs, and the MACCU TCC helper plus loopback auth. No force-push to default branches, no ruleset or admin bypass, no ~/.codex auth changes, no billing changes, no secret values in logs.
- Merge-queue required checks stay where a repo has them; full CI daily; main-guardian fixes main forward.
- Fork-only pushes through publish.sh. Local models loopback-only.
- Mason only for passwords, 2FA, device approvals and payments (no new spending without him). Nothing private made public.
- Hold list (Mason's own holds): phantom #197 #878 #743 #725 #738 #744 #693 #1228; phantom-secrets #140 #197 #375 #168 #418 #136; ashlr-plugin #152 #157.

## Use Stack from an agent

Read [llms.txt](https://stack.ashlr.ai/llms.txt) and [llms-full.txt](https://stack.ashlr.ai/llms-full.txt) first. In this repo those files are `packages/site/public/llms.txt` and `packages/site/public/llms-full.txt`. A short repo index is [llms.txt](./llms.txt) at the root.

These commands are read-only. They need no account. They print JSON and write nothing:

```bash
npx -y -p @ashlr/stack stack providers --json
npx -y -p @ashlr/stack stack recommend "B2B SaaS with auth, AI, and payments" --json
npx -y -p @ashlr/stack stack scan --json
npx -y -p @ashlr/stack stack templates list --json
```

Install on macOS or Linux (also installs Phantom Secrets if that CLI is missing):

```bash
curl -fsSL stack.ashlr.ai/install.sh | bash
```

Cursor, Claude Code, and Codex can share this stdio server. Paste it into `~/.cursor/mcp.json` or the project `.mcp.json`:

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

Claude Code shell:

```bash
claude mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp
```

Codex shell:

```bash
codex mcp add ashlr-stack -- npx -y -p @ashlr/stack -p ashlr-stack-mcp ashlr-stack-mcp
```

`stack onboard --json` prints a plan and writes nothing. `stack doctor --ecosystem --json` only reports which Ashlr tools are installed. Do not run `stack add`, `stack apply`, `stack import`, or `stack onboard --apply` until the user names the project and the provider.

Repo build and test steps stay in [STACK.md](./STACK.md#agent-quickstart-from-a-clone).

## Local lane MCP bridge (RQ-LOCAL-1)

`packages/mcp/src/local-lane.ts` runs the locus, lexicon and stack MCP servers as stdio children and republishes their tools as `<server>__<tool>` on loopback only, `http://127.0.0.1:<port>/mcp`. Serve with `bun packages/mcp/src/local-lane.ts serve [--port <n>]`. Smoke test with `bun packages/mcp/src/local-lane.ts smoke --json`, which exits 0 only when all three upstreams list tools and one routed call succeeds. Run it directly, not through `bun run`, which echoes into the JSON. Exposed tools include mutating ones such as `locus_request_pin`, and any local process can call the endpoint.

## Agents may
- Create branches, commit, and open pull requests.
- Turn on GitHub auto-merge (`phm improve --auto-merge` / `gh pr merge --auto`). Merge to main and ship to production on your own, with no human approval or manual merge; fix main forward. Never use an admin override.
- Fix CI, tests, docs, and dependencies, and iterate on review feedback.

## Kept limits (Article 1)
- Rotating, creating, or exposing secrets and tokens; no secret values in logs or chat.
- Force-pushing to the default branch, ruleset or admin bypass, or deleting repositories.
- Spending money, billing, or paid-plan changes (needs Mason).
- Outside messages: emails, posts, issues, or comments directed at people outside AshlrAI.
- Releases and publishes run through each repo's sanctioned release workflow, which any agent may dispatch.

## Getting started
Build, test and run instructions for agents are in [STACK.md](./STACK.md#agent-quickstart-from-a-clone).

## Docs freshness

- Marked `<!-- fresh:begin name -->` ... `<!-- fresh:end -->` blocks in `README.md`, `STACK.md`, `CHANGELOG.md`, `docs/` and `templates/` are generated from the sources of truth: `package.json` versions, the latest released CHANGELOG section, the CLI registry (`packages/cli/src/index.ts` plus each command's `meta.description`), the MCP tool catalog (`packages/mcp/src/tools.ts`) and the provider registry (`packages/core/src/providers/index.ts` plus each provider's `category`).
- After touching a version, manifest, `CHANGELOG.md`, command, tool or provider source, run `bun run fresh:sync` then `bun run fresh:check` (drift exits 1). Block types and usage: [scripts/freshness/README.md](./scripts/freshness/README.md). Tests: `bun run fresh:test`.
- `HOME=$(mktemp -d) bun test scripts/docs-freshness.test.ts` cross-checks the generated tables and counts against the TypeScript source (AST plus runtime dispatch) and verifies documented commands and flags exist.
- Source capabilities do not establish published package versions or provider readiness. Verify installed command help, such as `stack onboard --help`, before using release-specific examples.

## Hot files: bridge PRs carry changelog entries in the notes

`CHANGELOG.md`, `packages/site/src/data/CHANGELOG.md` and `packages/site/tests/changelog.test.ts` are the most contended files in the repo — each shows up in 10 or 11 of the 30 newest open PRs, so parallel bridge jobs collide on them constantly. A bridge PR does not edit those three files: the notes carry the entry instead. Write the changelog text in `BRIDGE_NOTES.md` at the worktree root; a later dedicated PR can land it in the changelog itself.

## Ground rules
- Keep diffs small and reviewable, with one concern per PR.
- Never commit secrets. Use Phantom Secrets placeholders.
- Never force-push to the default branch.
