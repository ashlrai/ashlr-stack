# Fleet repo hygiene report

Generated 2026-11-07T09:19:19.025Z by `scripts/repo-hygiene.ts` against `~/Projects/ashlrai`.
Read-only audit: worktrees, code size, dependency freshness, dead-code
candidates, test-hygiene signals, doc drift and CI flags. Candidate counts
are heuristics — verify before deleting anything.

| Repo | Fleet | Worktrees (prunable/detached) | Code LOC | Deps | Outdated | Dead exports | Tests | Broken links | Dirty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ashlr-md | yes | 253 (25/199) | 134,012 | 51 | 34 | 130 | 141 | 0 | 0 |
| ashlr-stack | yes | 119 (9/92) | 45,674 | 36 | 25 | 143 | 108 | 1 | 1 |
| phantom-secrets | yes | 130 (34/65) | 208,103 | 26 | 0 | 67 | 37 | 0 | 1 |
| locus | yes | 112 (43/55) | 89,495 | 0 | 0 | 1 | 2 | 0 | 1 |
| lexicon | yes | 74 (34/16) | 213,977 | 33 | 6 | 266 | 132 | 0 | 1 |
| ashlr-plugin | yes | 100 (31/53) | 236,365 | 69 | 43 | 468 | 339 | 1 | 1 |
| phantom | yes | 337 (56/144) | 1,557,640 | 89 | 24 | 4,539 | 2,156 | 7 | 26 |

Fleet totals: 1125 worktrees (232 prunable, 624 detached), 2,485,266 code LOC, 132 outdated deps, 5614 dead-export candidates, 2915 test files. Private repositories are left out of this committed report.

## ashlr-md

- HEAD `main` @ `7ee2415d` (2026-10-26T00:01:34-04:00), default `main`, 0 dirty files
- Deps: 51 declared across 3 manifests; stale check: bun outdated → 34 outdated (8 majors behind); lockfile drift: n/a; 1 possibly-unused; update automation: none found
  - possibly unused dep: `tslib` (integrations/obsidian)
  - e.g. @types/node 20.19.41→26.6.6, builtin-modules 3.3.0→5.5.0, esbuild 0.21.5→0.28.2, obsidian 1.13.0→1.14.4, tslib 2.8.1→2.9.1
- Dead code: 130 unique-name exports with no external identifier reference; 4 files with fully-unused imports (19 statements); TODO/FIXME: 0; #[allow(dead_code)]: 16
  - `integrations/vscode/src/cli.ts` exports `CliOutcome` (type)
  - `scripts/check-crypto.mjs` exports `PATTERNS` (const)
  - `src/ai/actions.ts` exports `buildActionMessages` (function)
  - `src/ai/actions.ts` exports `DocAction` (interface)
  - `src/ai/actions.ts` exports `streamAction` (function)
- Tests: 141 files, ~922 #[test] fns; skipped 26; sleep/timeout signals 45; network-call refs 38
- Docs: 54 markdown files; 0 broken relative links; 0 doc-referenced scripts missing from package.json
- CI: 2 workflows; pull_request_target refs: 0

## ashlr-stack

- HEAD `main` @ `1f86bfa` (2026-10-26T02:58:17-04:00), default `main`, 1 dirty files
- Deps: 36 declared across 6 manifests; stale check: bun outdated → 25 outdated (13 majors behind); lockfile drift: n/a; 1 possibly-unused; update automation: renovate
  - possibly unused dep: `react-dom` (packages/site)
  - e.g. @biomejs/biome 1.9.4→2.6.6, @types/bun 1.3.12→1.4.4, typescript 5.9.3→7.0.2, @clack/prompts 0.8.2→1.8.1, citty 0.1.6→0.2.2
- Dead code: 143 unique-name exports with no external identifier reference; 1 files with fully-unused imports (1 statements); TODO/FIXME: 0
  - `packages/cli/src/commands/add.ts` exports `AddArgs` (interface)
  - `packages/cli/src/commands/deps.ts` exports `buildDepsReport` (function)
  - `packages/cli/src/commands/deps.ts` exports `DepsReport` (interface)
  - `packages/cli/src/commands/doctor.ts` exports `checkService` (function)
  - `packages/cli/src/commands/doctor.ts` exports `ReconcileReport` (interface)
- Tests: 108 files; skipped 9; sleep/timeout signals 23; network-call refs 1
- Docs: 42 markdown files; 1 broken relative links; 0 doc-referenced scripts missing from package.json
  - broken link: `packages/site/src/data/CHANGELOG.md` → `docs/adding-a-provider.md`
- CI: 7 workflows; pull_request_target refs: 0

## phantom-secrets

- HEAD `main` @ `58c81eac` (2026-10-26T00:06:14-04:00), default `main`, 1 dirty files
- Deps: 26 declared across 5 manifests; stale check: cargo update --dry-run → 0 outdated (0 majors behind); lockfile drift: 0 updates / 0 adds / 0 removals; 3 possibly-unused; update automation: none found
  - possibly unused dep: `eslint-config-next` (apps/web)
  - possibly unused dep: `@remotion/cli` (video)
  - possibly unused dep: `@remotion/player` (video)
- Dead code: 67 unique-name exports with no external identifier reference; 0 files with fully-unused imports (0 statements); TODO/FIXME: 0; #[allow(dead_code)]: 7
  - `apps/web/src/components/landing/BrandLogos.tsx` exports `AnthropicLogo` (function)
  - `apps/web/src/components/landing/BrandLogos.tsx` exports `AwsLogo` (function)
  - `apps/web/src/components/landing/BrandLogos.tsx` exports `ClerkLogo` (function)
  - `apps/web/src/components/landing/BrandLogos.tsx` exports `CloudflareLogo` (function)
  - `apps/web/src/components/landing/BrandLogos.tsx` exports `CohereLogo` (function)
- Tests: 37 files, ~2968 #[test] fns; skipped 39; sleep/timeout signals 31; network-call refs 156
- Docs: 102 markdown files; 0 broken relative links; 0 doc-referenced scripts missing from package.json
- CI: 8 workflows; pull_request_target refs: 0

## locus

- HEAD `main` @ `cba5f65` (2026-10-26T00:11:18-04:00), default `main`, 1 dirty files
- Deps: 0 declared across 3 manifests; stale check: cargo update --dry-run → 0 outdated (0 majors behind); lockfile drift: 0 updates / 0 adds / 0 removals; 0 possibly-unused; update automation: renovate
- Dead code: 1 unique-name exports with no external identifier reference; 0 files with fully-unused imports (0 statements); TODO/FIXME: 0; #[allow(dead_code)]: 6
  - `scripts/check-crypto.mjs` exports `PATTERNS` (const)
- Tests: 2 files, ~975 #[test] fns; skipped 40; sleep/timeout signals 39; network-call refs 192
- Docs: 61 markdown files; 0 broken relative links; 0 doc-referenced scripts missing from package.json
- CI: 8 workflows; pull_request_target refs: 0

## lexicon

- HEAD `HEAD` @ `7cc3196` (2026-10-28T12:25:16-04:00), default `main`, 1 dirty files
- Deps: 33 declared across 3 manifests; stale check: npm outdated → 6 outdated (2 majors behind); lockfile drift: n/a; 1 possibly-unused; update automation: dependabot
  - possibly unused dep: `react-dom` (web)
  - e.g. @modelcontextprotocol/sdk 1.32.1→1.32.2, @types/chrome 0.3.6→0.3.7, @types/node 26.6.5→26.6.6, commander 14.0.3→15.1.0, jsdom 30.1.3→31.0.0
- Dead code: 266 unique-name exports with no external identifier reference; 8 files with fully-unused imports (11 statements); TODO/FIXME: 0
  - `bench/lib.ts` exports `Ratio` (interface)
  - `bench/lib.ts` exports `ReasonStats` (interface)
  - `bench/lib.ts` exports `SWEEP_STEPS` (const)
  - `extension/src/adapters.ts` exports `CODE_EDITOR_SELECTOR` (const)
  - `extension/src/adapters.ts` exports `editableRoot` (function)
- Tests: 132 files; skipped 17; sleep/timeout signals 49; network-call refs 87
- Docs: 65 markdown files; 0 broken relative links; 0 doc-referenced scripts missing from package.json
- CI: 6 workflows; pull_request_target refs: 0

## ashlr-plugin

- HEAD `main` @ `a4044ef` (2026-10-26T00:10:34-04:00), default `main`, 1 dirty files
- Deps: 69 declared across 6 manifests; stale check: bun outdated → 43 outdated (18 majors behind); lockfile drift: n/a; 5 possibly-unused; update automation: renovate
  - possibly unused dep: `@remotion/fonts` (video)
  - possibly unused dep: `@remotion/google-fonts` (video)
  - possibly unused dep: `@remotion/player` (video)
  - possibly unused dep: `@remotion/renderer` (video)
  - possibly unused dep: `@vscode/vsce` (vscode)
  - e.g. @types/bun 1.3.12→1.4.4, typescript 5.9.3→7.0.2, @modelcontextprotocol/sdk 1.29.0→1.32.2, minimatch 10.2.5→11.0.5, postgres 3.4.9→4.1.0
- Dead code: 468 unique-name exports with no external identifier reference; 36 files with fully-unused imports (47 statements); TODO/FIXME: 0
  - `bench/refs/node-sdk/src/agent/create-agent-ui-stream.ts` exports `createAgentUIStream` (function)
  - `bench/refs/node-sdk/src/error/invalid-argument-error.ts` exports `InvalidArgumentError` (class)
  - `bench/refs/node-sdk/src/error/invalid-tool-input-error.ts` exports `InvalidToolInputError` (class)
  - `bench/refs/node-sdk/src/generate-image/generate-image.ts` exports `GenerateImagePrompt` (type)
  - `bench/refs/node-sdk/src/generate-object/inject-json-instruction.ts` exports `injectJsonInstruction` (function)
- Tests: 339 files, ~7 #[test] fns; skipped 24; sleep/timeout signals 87; network-call refs 274
- Docs: 141 markdown files; 1 broken relative links; 0 doc-referenced scripts missing from package.json
  - broken link: `.ashlrcode/genome/knowledge/discoveries.md` → `docs/benchmarks.md`
- CI: 12 workflows; pull_request_target refs: 0

## phantom

- HEAD `cursor/fleet-dashboard-handoff-3af5` @ `e9f456132` (2026-10-26T04:16:00Z), default `master`, 26 dirty files
- Deps: 89 declared across 5 manifests; stale check: npm outdated → 24 outdated (6 majors behind); lockfile drift: n/a; 4 possibly-unused; update automation: dependabot
  - possibly unused dep: `date-fns` (examples/universe-site)
  - possibly unused dep: `react-server-dom-webpack` (examples/universe-site)
  - possibly unused dep: `@vitejs/plugin-rsc` (examples/universe-site)
  - possibly unused dep: `oxlint-tsgolint` (examples/universe-site)
  - e.g. @codemirror/autocomplete 6.20.3→6.20.4, @codemirror/language 6.12.4→6.13.1, @codemirror/legacy-modes 6.5.4→6.5.5, @codemirror/view 6.43.13→6.43.15, @lezer/highlight 1.2.4→1.2.5
- Dead code: 4539 unique-name exports with no external identifier reference; 49 files with fully-unused imports (110 statements); TODO/FIXME: 0; #[allow(dead_code)]: 2
  - `.github/scripts/ci-site-lane.mjs` exports `DOCS_ONLY_PATH_PATTERNS` (const)
  - `examples/universe-site/components/ui/accordion.tsx` exports `Accordion` (named)
  - `examples/universe-site/components/ui/accordion.tsx` exports `AccordionContent` (named)
  - `examples/universe-site/components/ui/accordion.tsx` exports `AccordionItem` (named)
  - `examples/universe-site/components/ui/accordion.tsx` exports `AccordionTrigger` (named)
- Tests: 2156 files, ~411 #[test] fns; skipped 349; sleep/timeout signals 712; network-call refs 1330
- Docs: 444 markdown files; 7 broken relative links; 5 doc-referenced scripts missing from package.json
  - broken link: `CHANGELOG.md` → `docs/RUNTIME-FLEET-ACTIVATION.md`
  - broken link: `workplans/2026-09-10-firm/task_plan.md` → `../../../src/core/resources/console-engineering-supervisor.ts`
  - broken link: `workplans/2026-09-10-firm/task_plan.md` → `../../../src/core/resources/engineering-successor-coordinator.ts`
  - missing script: `docs/ECOSYSTEM-MAP.md` → `check`
  - missing script: `docs/ECOSYSTEM-MAP.md` → `migrate`
  - missing script: `docs/internal/notes.md` → `check`
- CI: 12 workflows; pull_request_target refs: 3
