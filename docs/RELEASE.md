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

Source versions do not establish publication. On November 1, 2026, npm reported
0.3.0 for all three packages, and the v0.3.0 GitHub release had four native
binaries and checksum sidecars. Check registry, consumer and artifact evidence
again before updating guidance for any later version.

## Automatic releases

Merging a version bump to `main` publishes with no manual step. When
`packages/core/package.json` (which `packages/mcp` and `packages/cli` must
match) gains a new `X.Y.Z` version on `main`,
[`auto-tag.yml`](../.github/workflows/auto-tag.yml) requires every required
check green on that exact commit, creates `refs/tags/v<version>` with the
ashlr-release GitHub App token so the tag push starts `release.yml`, and
dispatches `release.yml` once if the tag push did not start it. The release
workflow resolves that tag to its commit and requires a successful
`workflow_dispatch` run of `ci.yml` on that exact commit. That event is the
full suite (tests, site, lint, and the secret scans, as enforced by CI Gate).
When no `workflow_dispatch` run exists yet, `release.yml` dispatches `ci.yml`
on the tag and waits until the run is green. A run that is still queued or in
progress is waited on and is not started again. A completed `workflow_dispatch`
that is not success blocks the release and is not retried. Pull-request,
merge-queue, and schedule runs do not qualify. Publishing starts only after
that evidence is green. Required checks are discovered at run time from branch
rules and protection; a check that is missing, pending or not successful
blocks the tag.

Manual paths (one command each, same gates):

```sh
gh workflow run auto-tag.yml -R ashlrai/ashlr-stack
gh workflow run release.yml -R ashlrai/ashlr-stack -f version=X.Y.Z
```

The `release.yml` dispatch requires the tag `vX.Y.Z` to exist already and
must be run from `main`; the legacy `tag` input (`-f tag=vX.Y.Z`) still works.

## Current script behavior

`scripts/publish.sh` accepts `--version`, `--yes` (or `-y`), and `--help`.
Even without `--yes`, it temporarily rewrites all three manifest versions and
`workspace:*` ranges, then runs `npm publish --dry-run` for each package. CLI/MCP
publication hooks can build output before the confirmation prompt. There is no
standalone read-only preview mode.

Confirmation, or `--yes`, publishes core, CLI, then MCP (`ashlr-stack-mcp` depends on `@ashlr/stack`), creates a tag if absent,
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
newer, and provenance enabled. It has no token fallback: the publish step does
not pass `NPM_TOKEN`, so a failed OIDC exchange fails the publish.
Actual publisher connections, permissions, and accepted publication remain
unverified here; no credential creation or settings change is prescribed.

After GitHub release success, a qualifying `refs/tags/v...` run can update the
Homebrew formula and commit/push to the tap, including dispatch on a tag ref.
It uses an existing referenced tap credential or skips when unavailable. Verify
actual tap commissioning and the remote formula separately.

## Auto-tagging

[`.github/workflows/auto-tag.yml`](../.github/workflows/auto-tag.yml) is the
wired auto-tag workflow: when the version in `packages/core/package.json`
changes on `main` and every required check for that exact commit is green, it
creates `refs/tags/v<version>` so the tag-triggered release workflow runs.
[`scripts/auto-tag.mjs`](../scripts/auto-tag.mjs) is a tested standalone
implementation of the same fail-closed design, invoked as `evaluate`
(read-only, writes `changed`/`version`/`green` to `$GITHUB_OUTPUT`) and
`create --version X.Y.Z` (needs a `contents: write` token; the ashlr-release
GitHub App mints it). `run` chains both for manual use. The workflow does not
call the script; it carries the equivalent steps inline.

## Qualification and partial failures

[CI](../.github/workflows/ci.yml) checks tests/typechecks on Bun 1.2.0 and latest,
the site check/build, and PR lint. Confirm required results for the exact source.

Completion requires reconciliation of source/tag/version, all three registry
packages and archive integrity, CLI/MCP consumer behavior, and public binaries
with checksums. Site deployment is separate.

Preserve logs and original artifacts after failure or uncertainty, then inspect
completed effects. Publication can be partial. The release workflow may dispatch
the full CI suite once when no `workflow_dispatch` run exists yet for the tag.
It does not retry an unsuccessful suite, republish, recreate, or move tags.
Review the exact follow-up target and release authorization first.

## Docs freshness

After a version commit lands on the default branch, run `bun run fresh:sync`
and verify with `bun run fresh:check`. Marked blocks (version badge, install
snippet, version table, pins) regenerate from the manifests and the latest
released CHANGELOG section; see [../scripts/freshness/README.md](../scripts/freshness/README.md).
