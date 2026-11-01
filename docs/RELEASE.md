# Releasing Ashlr Stack

This is a reference to the current [publish script](../scripts/publish.sh) and
[release workflow](../.github/workflows/release.yml). Follow the release authority
in [AGENTS.md](../AGENTS.md). Verify source qualification, registry publication,
and public artifacts separately.

## Package identities

The manifests name three packages:

- [`@ashlr/stack-core`](../packages/core/package.json)
- [`ashlr-stack-mcp`](../packages/mcp/package.json), unscoped
- [`@ashlr/stack`](../packages/cli/package.json)

Source versions do not establish publication. Registry observation on November 1,
2026 verified 0.3.0 for all three npm packages. Keep published guidance at 0.3.0
until a newer version has publication and consumer verification.

## Current script behavior

`scripts/publish.sh` accepts `--version`, `--yes` (or `-y`), and `--help`.
It validates that source manifests, CLI version and MCP descriptor match the
requested version, then temporarily rewrites `workspace:*` dependency ranges
and runs `npm publish --dry-run` for each package, even without `--yes`.
CLI/MCP publication hooks can build output before confirmation; there is no
standalone read-only preview mode.

Confirmation, or `--yes`, publishes core, CLI, then MCP (`ashlr-stack-mcp`
depends on `@ashlr/stack`), creates a tag if absent, and attempts to push it.
The exit trap restores the original manifests. On a tag-triggered run the script
checks the selected tag resolves to HEAD; outside that context an existing local
tag is skipped without that check. Tag push failure produces a warning.

The script selects no npm dist-tag. GitHub versions containing `-` are marked
prereleases by the workflow, but npm's `next` tag is not selected.

## Current workflow behavior

The workflow builds four native binaries and companion checksums, then invokes
the script and can create a public GitHub release with eight files.

Acceptance gaps remain:

- GitHub release creation requires the binary build, native smoke and npm
  publish jobs to succeed, but that does not independently verify registry bytes.
- A nonempty legacy `npm_otp` input is rejected before release producers run.
- Native builds precede npm manifest rewrites and npm-only OAuth client ID
  injection. Version, source, and configuration agreement need verification.
- Matching filenames establish neither public byte/checksum agreement nor npm
  archive integrity and provenance.

The workflow configures an OIDC attempt with `id-token: write`, npm 11.5.1 or
newer, and provenance enabled. It has no token fallback: the publish step does
not pass `NPM_TOKEN`, so a failed OIDC exchange fails the publish.
Actual publisher connections, permissions, and accepted publication remain
unverified here; no credential creation or settings change is prescribed.

After GitHub release success, a qualifying `refs/tags/v...` run can update the
Homebrew formula and commit/push to the tap on a qualifying tag push.
It uses an existing referenced tap credential or skips when unavailable. Verify
actual tap commissioning and the remote formula separately.

## Auto-tagging (pending workflow wiring)

[`scripts/auto-tag.mjs`](../scripts/auto-tag.mjs) is the fail-closed core of
the auto-tag design: when the version in `packages/cli/package.json` changes on
`main` and every required check for that exact commit is green, it creates
`refs/tags/v<version>` so the tag-triggered release workflow runs. It is
invoked as `evaluate` (read-only, writes `changed`/`version`/`green` to
`$GITHUB_OUTPUT`) and `create --version X.Y.Z` (needs a `contents: write`
token; the ashlr-release GitHub App mints it). `run` chains both for manual
use. No workflow calls it yet — the `.github/workflows` wrapper is applied
separately.

## Qualification and partial failures

[CI](../.github/workflows/ci.yml) checks tests/typechecks on Bun 1.2.0 and latest,
the site check/build, and PR lint. Confirm required results for the exact source.

Completion requires reconciliation of source/tag/version, all three registry
packages and archive integrity, CLI/MCP consumer behavior, and public binaries
with checksums. Site deployment is separate.

Preserve logs and original artifacts after failure or uncertainty, then inspect
completed effects. Publication can be partial. Never automatically rerun,
republish, recreate, or move tags; review the exact follow-up target and release
authorization first.

## Docs freshness

Run `bun run fresh:sync` and verify with `bun run fresh:check` on the reviewed
candidate. Source-version blocks follow the manifests and newest dated source
CHANGELOG section; published install pins follow the separately verified pointer.
See [../scripts/freshness/README.md](../scripts/freshness/README.md).
