# Changelog mirroring

Release notes live in two checked-in copies:

| Copy | Path | Role |
| --- | --- | --- |
| Root | [`CHANGELOG.md`](../CHANGELOG.md) | Source of truth |
| Site | [`packages/site/src/data/CHANGELOG.md`](../packages/site/src/data/CHANGELOG.md) | Mirror rendered at `/docs/changelog` |

The site's `sync-content` script (run by `dev`, `start` and `build`) copies the
root file over the site copy. Nothing merges the other direction, so an edit
made only to the site copy is lost on the next build.

## The `stack apply` entry

The current `stack apply` entry sits in **both** copies under
**Unreleased → Changed**:

> `stack apply` does not create placeholder secrets. After at least one
> provider succeeds, wiring checks secret names for every provider in the
> recipe ...

| Copy | Location |
| --- | --- |
| `CHANGELOG.md` | first bullet under `## Unreleased` → `### Changed` |
| `packages/site/src/data/CHANGELOG.md` | the same bullet, same section |

Older `stack apply` entries (0.3.0, 0.2.2, 0.2.1, 0.1.0) are mirrored the same
way.

## Maintainer rule

Keep both copies consistent. Edit `CHANGELOG.md` first, then update the site
copy to match. Do not change the wording, conditions or examples of the
`stack apply` entry in only one file.

1. Edit the root `CHANGELOG.md`.
2. Sync: `bun run --cwd packages/site sync-content`. The script hides copy
   errors, so verify afterwards.
3. Verify the files match; no output and exit 0 means identical:

   ```sh
   diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md
   ```

4. Confirm the entry exists once in each file:

   ```sh
   grep -n -F '`stack apply` does not create placeholder secrets.' CHANGELOG.md packages/site/src/data/CHANGELOG.md
   ```

5. Run the checks: `HOME=$(mktemp -d) bun test packages/site/tests/changelog.test.ts scripts/changelog-mirroring.test.ts`.

See also [changelog-site-sync.md](changelog-site-sync.md) and the
[mirror review](changelog-mirror-review.md).
