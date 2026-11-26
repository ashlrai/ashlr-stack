# Coverage recovery investigation

- User requires no commits, pushes, publishes or duplicate guardian jobs.
- Existing scripts/coverage-diagnostic.ts and its tests/docs must be assessed before changes.

## Evidence
- Baseline full coverage reproduces `cli: binaries/**/*` validation failure; already documented and left to the existing guardian fix.
- Stalled top-level await fixture + existing diagnostic, killed by a 1000ms outer timeout: status=null, signal=SIGKILL, stdout="", error=ETIMEDOUT. The wrapper has no deadline and only emits its report after Bun returns.
- Historical/open-PR lookup through Locus denied: selected session expired. No identity mutation or alternate credential access attempted. Shared roster has no live claims; no coverage PR titles listed.
- Add a diagnostic timeout, with a typed option and CLI override, preserving the CI test arguments and guardian workflow.
- Initial lint and typecheck passed. Dependencies installed with frozen lockfile.
- Final focused suite: 20 pass, 0 fail. Coverage: passed with 826-byte LCOV. Known package-validation reproduction: 23 pass, 1 fail, nonempty LCOV, correctly classified test-command-failed.
- Root typecheck excludes scripts; explicitly typechecked both touched scripts too. Fixed the resulting Error.code narrowing error without casts.
- Process inspection is denied by macOS, so orphan inspection after the deliberately outer-killed reproduction could not run. Regression fixture self-expires as a fallback and verifies the diagnostic cleans temporary directories.
- Initial full run started before install completion and cached missing module errors (2072 pass, 10 skip, 276 fail, 197 errors); do not treat these as a clean baseline. A clean full run is now underway after dependencies are installed.
