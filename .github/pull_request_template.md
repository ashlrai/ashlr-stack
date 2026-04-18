## What this changes

<!-- one paragraph -->

## Why

<!-- link to issue / real-world motivation / one-line why -->

## Checklist

- [ ] `bun test` — 69/69 pass (plus any new tests)
- [ ] `bunx tsc --noEmit -p tsconfig.json` clean
- [ ] If a new provider was added: registered in `providers/index.ts`, added to `detect.ts` + `detect-source.ts`, test file written, `docs/provider-auth-matrix.md` updated, `packages/site/src/lib/providers.ts` updated for the landing page
- [ ] If a new CLI command was added: registered in `cli/src/index.ts`, added to `completion.ts`, surfaced in `mcp/src/server.ts` if appropriate, documented in `packages/site/src/lib/cli-ref.ts`
- [ ] `CHANGELOG.md` updated

## Screenshots / terminal output

<!-- only if the change is user-visible -->
