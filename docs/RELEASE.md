# Releasing Ashlr Stack

Release cuts are fully automated by `.github/workflows/release.yml`.

## Prerequisites (one-time)

1. **`NPM_TOKEN`** repository secret — an npm access token with publish rights to `@ashlr/stack`, `@ashlr/stack-core`, and `@ashlr/stack-mcp`. Set at `https://github.com/ashlrai/ashlr-stack/settings/secrets/actions`.
2. Your local working tree matches `main` and `bun install` succeeds.

## Cutting a release

```sh
# 1. Dry-run first to preview what will publish.
scripts/publish.sh --version 0.1.0            # prompts, no --yes

# 2. When dry-run looks right, push the tag.
git tag v0.1.0
git push origin v0.1.0
```

The tag push triggers `.github/workflows/release.yml`, which:

1. **Compiles 4 binaries in parallel** via `bun build --compile`:
   - `stack-linux-x64`
   - `stack-linux-arm64`
   - `stack-darwin-x64`
   - `stack-darwin-arm64`
   - Each gets a companion `.sha256` file.
2. **Publishes to npm** (`scripts/publish.sh --version X.Y.Z --yes`):
   - `@ashlr/stack-core`
   - `@ashlr/stack-mcp`
   - `@ashlr/stack`
3. **Creates a GitHub Release** with all 8 assets + auto-generated changelog.

Prerelease tags (e.g. `v0.1.0-rc.1`) are automatically marked as pre-releases and get the `next` dist-tag on npm.

## After release

Verify:

```sh
# Installs via the one-liner — should pick up the prebuilt binary.
curl -fsSL https://stack.ashlr.ai/install.sh | bash
stack --version

# npm publish succeeded?
npm info @ashlr/stack version

# GitHub Release assets visible?
gh release view v0.1.0 --repo ashlrai/ashlr-stack
```

## Hotfix / re-run

If a release fails partway through:

- **npm publish failed** — fix the issue, bump the patch version, cut a new tag. npm versions are immutable; you can't re-publish `0.1.0`.
- **Binary build failed on one arch** — re-run the failed matrix job from the Actions UI; `create-release` has `fail_on_unmatched_files: true` so it will only publish once every asset is present.
- **Release workflow didn't trigger** — tags must match `v*.*.*` exactly. Push again with the right shape.

## Manual trigger

The workflow supports `workflow_dispatch` for emergency re-runs:

```
Actions → Release → Run workflow → version: 0.1.0
```

This bypasses the tag push but still expects `scripts/publish.sh` semantics (the tag will already exist from the previous attempt; `publish.sh` skips tagging if it's there).
