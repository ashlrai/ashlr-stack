# scripts/freshness: docs freshness generator

Source-of-truth freshness for versioned text in the docs. `sync.mjs`
regenerates marked blocks; `check.mjs` is the read-only gate that exits 1 on
drift. Plain `.mjs`, no dependencies, runs under Node 18+ or Bun.

## Source of truth

- Release version: `packages/cli/package.json` `version` (the three shipped
  manifests `packages/{core,cli,mcp}/package.json` must agree, and
  `packages/mcp/server.json` plus `const VERSION` in
  `packages/cli/src/index.ts` must match).
- Latest released section: first `## x.y.z (date)` heading in `CHANGELOG.md`
  (`## Unreleased` is skipped); it must equal the release version.
- Monorepo version: root `package.json` `version` (private; shown in the
  version table only).

If these disagree, both scripts exit nonzero and write nothing: the release
version would be ambiguous. Fix the manifest, changelog or `VERSION` first.

## Markers

Wrap generated content in HTML comments:

```
<!-- fresh:begin NAME -->
stale or empty content, replaced by sync
<!-- fresh:end -->
```

An inline form pins a single value inside prose:

```
this checkout is version <!-- fresh:begin version-pin -->0.2.2<!-- fresh:end -->
```

Known block names:

| Name | Generates |
| --- | --- |
| `version-pin` | the bare release version (`0.2.2`); inline-capable |
| `version-badge` | shields badge pinned to the source version, linking to `CHANGELOG.md` |
| `install-snippet` | fenced `bun add -g` (or `npm i -g`) with both packages pinned |
| `version-table` | markdown table of shipped manifests, versions and the latest changelog section |

Scanned files: `README.md`, `STACK.md`, `CHANGELOG.md`, and `*.md` under
`docs/` and `templates/`. Keep markers out of fenced code blocks (the comments
render literally) and out of this README (this directory is not scanned).

## Usage

```bash
bun run fresh:sync     # rewrite stale blocks in place
bun run fresh:check    # exit 1 on drift or malformed markers
node --test scripts/freshness/freshness.node-tests.mjs
```

Both scripts take `--root <dir>` to run against another checkout, which the
test suite uses against fixtures. In a repo without a root `package.json`
(that is, the cargo-workspace layout), there is no npm script runner: call the
scripts directly, for example `node scripts/freshness/check.mjs --root .` from
the workspace root, or wire the same line into `just`, `make` or CI.
