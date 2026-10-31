# Scan an existing project

`stack scan` looks for evidence of supported providers in a project directory.
The default is a read-only report; a detection is a heuristic, not proof that a
service is configured or working. The rules are defined in
[`detect-source.ts`](../packages/core/src/detect-source.ts).

```bash
stack scan                                  # current directory, human report
stack scan --path ./apps/api --confidence low
stack scan --path ./apps/api --json         # machine-readable report
stack scan --auto                           # ask before adding each detection
stack scan --yes                            # add high-confidence detections without prompts
```

`--path` accepts a relative or absolute directory path and defaults to `.`.
Scanning is per directory, not recursive: point it at each nested project
separately. A bare scan also works without a terminal. `--auto` requires a
terminal unless combined with `--yes`; otherwise it exits with an error.

## Inputs and confidence

The scanner checks these paths relative to the selected directory:

| Input | Evidence checked |
| --- | --- |
| `package.json` | Recognized names in `dependencies` and `devDependencies`. |
| `requirements.txt`, `pyproject.toml` | Recognized Python package names. The `pyproject.toml` check is text matching and covers a smaller set than `requirements.txt`. |
| `go.mod`, `Cargo.toml` | Recognized Go module paths and Rust crate names. |
| Provider configuration | `vercel.json`, `.vercel`, `fly.toml`, `railway.json`, `railway.toml`, `supabase/config.toml`, `sentry.properties`, `sentry.client.config.ts` / `.js`, `sentry.server.config.ts` / `.js`, `amplify.yml`, `wrangler.toml` / `.jsonc` / `.json`, `convex/`, `convex.config.ts`, `firebase.json`, `.firebaserc`, and `render.yaml`. These are presence checks. |
| `.github/workflows` | The path itself is a medium signal; a `.yml` or `.yaml` entry is a high signal. |
| `.env.example`, `.env.sample`, `.env.template` | Recognized variable names are medium signals; their values are not reported. |

Only recognized names and paths count. Source code, arbitrary files, lockfiles,
and actual `.env` files are not scanned. Missing input files are fine. The CLI
rejects a missing or non-directory `--path`, invalid `--confidence`, and an
unreadable or malformed root `package.json` instead of reporting a partial
result.

`--confidence` sets the minimum tier: `low`, `medium`, or `high` (case
insensitive). The default is `medium`, or `high` with `--yes`, including when
combined with `--json`. A provider with multiple signals is reported once at
its highest signal confidence. The report shows up to three evidence strings;
JSON includes all of them.

## Results and adding providers

`--json` writes an object with a `hits` array. Each hit has `provider`,
`confidence`, and `sources` fields. It exits without prompting or adding, even
when combined with `--auto` or `--yes`.

```json
{
  "hits": [
    {
      "provider": "vercel",
      "confidence": "high",
      "sources": ["vercel.json"]
    }
  ]
}
```

When no signals meet the threshold, JSON is `{"hits": []}` and the human
report says `No providers detected` and suggests `--confidence low`. Both
exit successfully. This can mean there are no recognized signals **or** that
all signals are below the threshold. An empty result returns before Phantom
preflight and does not create `.stack.toml`, including with `--yes`. A
non-terminal `--auto` without `--yes` still errors before the empty report;
use `--json` for a headless read-only scan.

With qualifying results, `--auto` runs the Phantom preflight, seeds
`.stack.toml` if needed, and asks before adding each registered provider;
`--yes` implies `--auto` and adds without prompting. Providers already in the
stack are skipped. Review the report and confidence before using these modes,
since adding can provision or configure services.
