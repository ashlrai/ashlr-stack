# Release train status

Snapshot: 2026-11-07 UTC. This is a point-in-time, read-only audit, not a publication receipt. Default-branch heads, public releases, tags, comparisons and recent Actions runs were queried through the GitHub REST API. `gh` could not read its local configuration (`operation not permitted`), so private repository data and authenticated grants were unavailable. Local `origin` refs were used for manifests and workflow source; they can lag GitHub. Counts below compare the latest published GitHub release tag with the default branch, not package registry contents. A commit count is not a claim that every commit warrants a release.

Phantom's default branch is **master**; ashlar-landing's cached default branch is also master. Other accessible repositories use main. In particular, the public `v3.30.24` release is in `ashlrai/phantom`, whose package is `@ashlr/phantom`; the separate `ashlrai/phantom-secrets` repository has a `0.8.8` Cargo manifest. Do not conflate the two trains.

| Repository | Manifest at examined ref | Latest tag / published GitHub release | Default branch relative to release | Candidate and immediate status |
| --- | --- | --- | --- | --- |
| phantom | `3.30.24` at live `6778b16` | `v3.30.24` / `v3.30.24` | 7 ahead | Same version; assess changes for a future bump. CI on the observed head succeeded. |
| phantom-secrets | `0.8.8` at live `f065c53` | `v0.8.8` / `v0.8.7` | 26 ahead; 1 ahead of `v0.8.8` | `v0.8.8` release run [failed](https://github.com/ashlrai/phantom-secrets/actions/runs/42345792699); reconcile partial publication. |
| locus | `0.7.0` at live `f360437` | `v0.7.0` / `v0.7.0` | 34 ahead | Review changes for next version; no newer version established. Recent CI results were for an earlier head. |
| ashlr-md | `0.7.4` in package, Tauri and Cargo at cached `be8a1c8` | `v0.7.4` / `v0.7.3` | 182 ahead | `v0.7.4` release run [failed](https://github.com/ashlrai/ashlr-md/actions/runs/42341508791); live head `2cfa23c` was newer than cached source and CI was in progress. Recheck manifest and CI. |
| ashlr-plugin | `1.38.5` at cached `eceda54` | `v1.38.5` / `v1.38.4` | 23 ahead | `v1.38.5` release run [failed](https://github.com/ashlrai/ashlr-plugin/actions/runs/42341441463); live head `eb94322` was newer and CI was in progress. Recheck manifest and CI. |
| ashlr-stack | core, CLI and MCP `0.3.8` at live `65f1725` | `v0.3.8` / `v0.3.7` | 29 ahead | `v0.3.8` release run [failed](https://github.com/ashlrai/ashlr-stack/actions/runs/42341627666); reconcile npm and binary effects. Root private monorepo version is `0.1.0`. |
| lexicon | `0.5.9` at live `8553db4` | `v0.5.9` / `v0.5.9` | 1 ahead | Review the one commit for the next bump; release and CI succeeded at the tag commit, not necessarily the current head. |
| measurably | package and Cargo `0.2.0` at cached `28ff9a7` | No cached tags; GitHub releases unavailable | Unknown | GitHub returned 404 without authentication; verify default head, deployment and grant state with authorized access. |
| ashlar-landing | package `0.1.0` at cached `7ce94b6` | No cached tags; GitHub releases unavailable | Unknown | GitHub returned 404 without authentication; verify deployment and whether a release train applies. |

For md, plugin and stack, the GitHub head advanced during the audit or was not present in the corresponding local object database. Stack's examined ref matched the reported head when the manifest was read. A 404 can mean a private or inaccessible repository; it does not prove a repository or release is absent. Tag ordering shown is GitHub's tag-list order, corroborated by cached version-sorted tags for accessible repos; a published GitHub release is distinct from a tag and from registry acceptance.

## Release paths and constraints

- **Phantom:** `auto-tag.yml` watches `package.json` on master and CI completion; the repo has separate release PR, canonical npm, registry, desktop and GitHub-release finalization workflows. Its `release.yml` is restricted to the historical `v3.3.2` tag, so do not assume it publishes current versions. Trace the actual train and its grants before action.
- **Phantom Secrets:** `auto-tag.yml` watches `Cargo.toml` on main and CI completion; `release.yml` runs on version tags. The failed `v0.8.8` run requires job-level and registry reconciliation before a fix-forward decision.
- **Locus, ashlr-md, ashlr-plugin, ashlr-stack and lexicon:** `auto-tag.yml` watches the respective version manifests and CI completion; tag pushes trigger `release.yml`. These release workflows also expose a dispatch for an existing version/tag. Auto-tag requires qualifying checks; dispatch availability does not establish that replay is safe. Stack's [release guide](RELEASE.md) describes known partial-publication and npm acceptance gaps.
- **Measurably:** cached `production-release.yml` follows successful main CI only when its production owner and exact approved SHA variables match; its manual dispatch stages and smoke-tests an exact SHA without promotion. The Production environment and Vercel configuration are additional prerequisites. Their current values and deployment state are unverified.
- **Ashlar landing:** no release or deployment workflow was found in the cached default-branch `.github/workflows`; determine the actual hosting/deployment integration before assuming a tag is relevant.

The standing hold list applies to the listed issues/PRs in [AGENTS.md](../AGENTS.md), including Phantom, Phantom Secrets and ashlr-plugin. This audit did not establish that any held item is included in a candidate; check candidate ancestry and open holds before advancing. Required checks, app installation permissions, trusted-publisher grants, environment restrictions, registry acceptance and the version-bump-train launchd job's current state were not authenticated or verified. Treat them as prerequisites to check, not proven failures. No conclusion about the cause of the four failed runs is made from their outcome alone.

## Recommended order

1. Inspect failed jobs and existing artifacts for the four failed tagged candidates, starting with Phantom Secrets, then md, plugin and Stack. Determine what actually published before choosing a sanctioned recovery or new fix-forward version. Never move an existing tag or blindly replay a partially successful publish.
2. Verify required checks on the current exact default-branch commits, including the md and plugin runs that were pending, and check holds and publisher/environment grants. Reconcile package registries, release assets and checksums independently of GitHub release existence.
3. Review the unreleased default-branch changes in locus, Phantom and lexicon for version-bump candidates; qualify each through its own train. Recheck version-bump-train job health rather than assuming it will create a bump.
4. With authorized repository visibility, establish measurably's production owner/SHA and deployment state, then identify ashlar-landing's actual deployment path. Their relative order depends on that evidence.

This sequence prioritizes unresolved publication state and verified dependencies, not a judgment about product value. Re-query heads, runs and releases immediately before any later release action.
