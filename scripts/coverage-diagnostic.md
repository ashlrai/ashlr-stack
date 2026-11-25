# Diagnose a Coverage failure

After `bun install --frozen-lockfile`, run from the repo root:

```sh
bun scripts/coverage-diagnostic.ts
```

Test output streams to stderr. Stdout is one JSON report, typed by
`CoverageDiagnostic` in [coverage-diagnostic.ts](coverage-diagnostic.ts).
Optional test paths narrow a reproduction, for example
`bun scripts/coverage-diagnostic.ts test/package-files-paths.test.ts`.
Each run uses a temporary HOME and fresh coverage directory, then removes both.
It leaves existing coverage files alone and does not upload or repair anything.

| Status | Exit | Meaning |
| --- | --- | --- |
| `passed` | 0 | Test command succeeded and LCOV is nonempty. |
| `test-command-failed` | 1 | Bun exited nonzero, even if LCOV exists. Inspect test output first. |
| `missing-artifact` | 2 | Bun succeeded but produced no nonempty LCOV file. |
| `runner-error` | 3 | Bun could not start or was terminated by a signal. |

The [Coverage workflow](../.github/workflows/coverage.yml) runs the full suite
after merges; CI Gate runs only Tier-1 tests. Its `set -e` stops on a failing
test command before checking LCOV, and `needs: test` then skips the upload job.
There is no local coverage threshold; [Codecov statuses](../codecov.yml) are
informational and uploader errors are nonfatal. A red Coverage workflow alone
therefore does not establish a missing artifact or low coverage.

A fresh-checkout reproduction on Bun 1.3.14 fails package-file validation because
`packages/cli/binaries/` is absent; the CLI manifest includes `binaries/**/*`.
That is a test failure to route to the existing test/guardian fixup, not evidence
to change coverage publishing. Historical guardian runs need their own failing
step logs to establish the cause. The regression fixtures cover failing tests
with LCOV, successful tests without LCOV, and stale artifacts separately.
