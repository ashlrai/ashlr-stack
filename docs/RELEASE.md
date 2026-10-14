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

Source versions do not establish publication. Retain the existing 0.1.1 install
guidance until a new version has publication and consumer verification.

## Current script behavior

`scripts/publish.sh` accepts `--version`, `--yes` (or `-y`), and `--help`.
Even without `--yes`, it temporarily rewrites all three manifest versions and
`workspace:*` ranges, then runs `npm publish --dry-run` for each package. CLI/MCP
publication hooks can build output before the confirmation prompt. There is no
standalone read-only preview mode.

Confirmation, or `--yes`, publishes core, MCP, then CLI, creates a tag if absent,
and attempts to push it. The exit trap restores the original manifests, including
their versions; no source version commit is made. Existing tag targets are not
checked against the publishing source. Tag push failure produces a warning.

The script selects no npm dist-tag. GitHub versions containing `-` are marked
prereleases by the workflow, but npm's `next` tag is not selected.

## Current workflow behavior

The workflow builds four native binaries and companion checksums, then invokes
the script and can create a public GitHub release with eight files.

Acceptance gaps remain:

- npm publication uses `continue-on-error`; GitHub release creation checks binary
  build success without requiring verified npm acceptance.
- Nonempty `npm_otp` becomes `--otp=...`, which the script rejects.
- Native builds precede npm manifest rewrites and npm-only OAuth client ID
  injection. Version, source, and configuration agreement need verification.
- Matching filenames establish neither public byte/checksum agreement nor npm
  archive integrity and provenance.

The workflow configures an OIDC attempt with `id-token: write`, npm 11.5.1 or
newer, and provenance enabled. Its token fallback references `NPM_TOKEN`.
Actual publisher connections, permissions, and accepted publication remain
unverified here; no credential creation or settings change is prescribed.

After GitHub release success, a qualifying `refs/tags/v...` run can update the
Homebrew formula and commit/push to the tap, including dispatch on a tag ref.
It uses an existing referenced tap credential or skips when unavailable. Verify
actual tap commissioning and the remote formula separately.

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
