# scripts/freshness: docs freshness generator

Source-of-truth freshness for generated text in the docs. `sync.mjs`
regenerates marked blocks; `check.mjs` is the read-only gate that exits 1 on
drift. Plain `.mjs`, no dependencies, runs under Node 18+ or Bun.

## Source of truth

- Release version: `packages/cli/package.json` `version` (the three shipped
  manifests `packages/{core,cli,mcp}/package.json` must agree, and
  `packages/mcp/server.json` plus `const VERSION` in
  `packages/cli/src/index.ts` must match).
- Verified published version: `scripts/freshness/published.json`, updated only after all three npm packages and artifacts are verified. Root install commands and docs' published cells use it, independently of the source version.
- Latest dated section (not proof of publication): first `## x.y.z (date)` heading in `CHANGELOG.md`
  (`## Unreleased` is skipped); it must equal the release version.
- Monorepo version: root `package.json` `version` (private; shown in the
  version table only).
- CLI commands: the lazy `import("./commands/<file>.ts")` entries of the
  `subCommands` object in `packages/cli/src/index.ts`, in declaration order,
  plus each file's `meta { name, description }`.
- MCP tools: the `{ name: "stack_*" }` entries of `packages/mcp/src/tools.ts`,
  in declaration order. A tool's CLI route is the leading run of string
  literals in its `cliArgs` argv, before flags or interpolated values.
- Providers: the `import("./<file>.ts")` entries of the registry in
  `packages/core/src/providers/index.ts`, plus the distinct `category: "<name>"`
  literal across those files.

If the version sources disagree, both scripts exit nonzero and write nothing:
the release version would be ambiguous. Fix the manifest, changelog or
`VERSION` first. If a command, tool or provider source breaks the conventions
above (a renamed registry shape, a non-literal category), the affected blocks
report an error instead of generating silently wrong content.

## Markers

Wrap generated content in HTML comments:

```
<!-- fresh:begin NAME -->
stale or empty content, replaced by sync
<!-- fresh:end -->
```

An inline form pins a single value inside prose (several pairs may share one
line):

```
this checkout is version <!-- fresh:begin version-pin -->0.2.2<!-- fresh:end -->
```

Known block names:

| Name | Generates |
| --- | --- |
| `version-pin` | the bare source version (`0.2.2`); inline-capable |
| `published-pin` | the last verified published version; inline-capable |
| `published-install-snippet` | npm install with the verified published version |
| `version-badge` | shields badge pinned to the source version, linking to `CHANGELOG.md` |
| `install-snippet` | fenced `bun add -g` (or `npm i -g`) with both packages pinned |
| `version-table` | markdown table of shipped manifests, versions and the latest changelog section |
| `commands-table` | markdown table of every registered `stack` command and its source description |
| `tools-table` | markdown table of every MCP tool and the CLI route it dispatches to |
| `command-count` | number of registered `stack` subcommands; inline-capable |
| `tool-count` | number of declared MCP tools; inline-capable |
| `provider-count` | number of providers in the source registry; inline-capable |
| `category-count` | number of distinct categories across registered providers; inline-capable |

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
