## What this changes

<!-- one paragraph -->

## Why

<!-- link to issue / real-world motivation / one-line why -->

## Checklist

<!-- Full path for humans and agents: CONTRIBUTING.md#contribute-with-an-agent -->

CI Gate (the one required check) runs these; run them locally first:

- [ ] `bunx tsc --noEmit -p tsconfig.json` clean
- [ ] `bun test packages/core/src/__tests__/security.test.ts packages/core/src/__tests__/secret-redaction.test.ts` pass
- [ ] `bun run check:crypto` pass
- [ ] No secret values in the diff (Phantom Secrets placeholders only; the Gitleaks and `scrub.pl` scans fail closed)

The full suite runs daily on `main`, not per PR, so check it yourself:

- [ ] Tests for this change pass (`bash scripts/fast-check.sh` for changed packages, `scripts/affected-tests origin/main`, or `HOME=$(mktemp -d) bun test` for the full suite)
- [ ] `bun run lint` clean
- [ ] If a version, manifest, command, MCP tool or provider changed: `bun run fresh:sync`, then `bun run fresh:check` passes
- [ ] If a new provider was added: every step in `docs/adding-a-provider.md` (registered in `providers/index.ts` and `catalog.ts`, added to `detect.ts` + `detect-source.ts`, test written, `docs/provider-auth-matrix.md` and `packages/site/src/lib/providers.ts` updated)
- [ ] If a new CLI command or MCP tool was added: the steps in `STACK.md#typical-tasks` (`completion.ts`, `mcp/src/tools.ts`, `COMMAND_ORDER` in `packages/site/scripts/gen-cli-ref.ts`, `packages/site/src/lib/cli-ref.generated.ts` regenerated and committed)
- [ ] Changelog entry: in `CHANGELOG.md` under Unreleased, or for a parallel bridge PR in `BRIDGE_NOTES.md` instead (see `AGENTS.md`)

## Screenshots / terminal output

<!-- only if the change is user-visible -->

## Notes for reviewers

<!-- Anything risky, breaking, or worth a closer look -->
