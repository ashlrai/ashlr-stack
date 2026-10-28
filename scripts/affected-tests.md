# Affected Bun tests

Run `scripts/affected-tests <base>` from any directory. The base must be a local
Git revision with merge history available. Only committed changes in
`base...HEAD` are considered, not staged or working tree changes.

Stdout is one JSON array of repository-relative Bun test targets, or the literal
`ALL`. An empty array means no tests. Parse the array and pass its elements as
arguments to `bun test` from the repository root. For `ALL`, run `bun test`.
For `[]`, skip the test command: bare `bun test` would run everything.
Invalid revisions or missing history exit nonzero with no stdout; callers must
stop or run the full suite, never interpret failure as an empty selection.

Core, CLI, MCP, site and plugin inputs select the four product packages together:
their tests inspect each other's sources, generated references and artifacts.
Telemetry changes select the telemetry package. Selector changes select its own
test file. Targets are sorted and deduplicated. Package targets cover deleted
tests and shared fixtures without referring to a missing test file.

Root prose, Markdown/text under `docs/`, and package READMEs/licenses are treated
as documentation only. Site content and plugin Markdown remain product inputs.
Lockfiles, manifests and configuration select `ALL`, as do unknown paths, new
packages, shared scripts and templates. This intentionally favors extra tests
over silently omitting consumers. Renames include both old and new paths.

The fixtures contain newline-separated `git diff --name-only` output. Production
uses NUL delimiters so spaces and newlines in filenames remain intact. No CI
workflow or publication behavior is changed.
