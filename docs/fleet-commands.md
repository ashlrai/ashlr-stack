# Fleet commands

For the machinery and its verification limits, see the [fleet architecture map](fleet-architecture.md).

The `stack fleet-*` commands report on the Ashlr build fleet: dispatch lanes,
job outcomes, CI health and release lag. Most read from `~/.ashlr-runs`; the
GitHub-backed reports reach GitHub through Locus. Every command accepts
`--json` for a `schemaVersion 1` report. Sources are the `defineCommand` meta
and args in `packages/cli/src/commands/fleet-*.ts`, tested by
`packages/cli/src/commands/fleet-docs.test.ts`. Run
`stack <command> --help` for current syntax. `fleet-collisions`, `fleet-slo`
and `fleet-waste` also run nested as `stack fleet collisions|slo|waste`.

| Command | Purpose |
| --- | --- |
| `fleet-act` | Preview fleet requests; `--apply` appends a v1 audit request for a dispatcher consumer. |
| `fleet-bets` | Score leader bets by joining queue ledger ids with dispatch state and job outcomes. |
| `fleet-collisions` | Rank touched files by open conflicting PR count from one repository's gh JSON. |
| `fleet-delivery-lag` | Report undeployed merged commits and merge wait from a read-only JSON fixture. |
| `fleet-graph` | Emit schema-versioned fleet pool, job, and repository nodes and edges. |
| `fleet-lag` | Report per-repo commits since latest tag, tag age and median merge time for the last 20 PRs. |
| `fleet-lanes` | Report lane targets, running and queued work, and dispatch idle reasons. |
| `fleet-latency` | Report per-repo median and p90 open-to-merge seconds for PRs merged in the last six hours. |
| `fleet-reds` | List failed jobs and first failing tests in the latest completed schedule/push CI runs. |
| `fleet-silent` | Name silent fleet failures in author, dispatch and job logs (read-only JSON). |
| `fleet-slo` | Compare per-repo six-hour merges, open-to-merge latency and conflicting PRs with fleet SLO targets. |
| `fleet-stream` | Translate fleet logs to typed NDJSON or localhost SSE. |
| `fleet-stuck` | List open PRs by merge state, age and auto-merge status with server/ and lockfile path hints. |
| `fleet-supply` | Report hourly launches, observed lane idle minutes, restock errors and UTF-8 queue splits. |
| `fleet-waste` | Report per-lane launches, empty finishes, precheck skips by code and unfinished jobs. |

## Flags

- **fleet-act**: positional `verb` (required: `pause`, `resume`, `kill`,
  `reassign`, `slots` or `steer`); `--lane`, `--job`, `--slots`, `--message`
  (verb inputs), `--queue`, `--apply`, `--dryRun`, `--json`.
- **fleet-bets** — `--json`, `--queue`, `--router`, `--ready`, `--metrics`,
  `--src`.
- **fleet-collisions** — `--file` (JSON input; omit or `-` for stdin),
  `--json`.
- **fleet-delivery-lag** — `--fixture` (required JSON snapshot), `--json`.
- **fleet-graph** — `--json`, `--queue`, `--router`.
- **fleet-lag** — `--json`.
- **fleet-lanes** — `--json`, `--queue`.
- **fleet-latency** — `--json`.
- **fleet-reds** — `--json`.
- **fleet-silent** — `--runs`, `--json`.
- **fleet-slo** — `--json`.
- **fleet-stream** — `--dispatch`, `--jobs`, `--follow`, `--sse`, `--port`.
- **fleet-stuck** — `--json`.
- **fleet-supply** — `--json`, `--queue`, `--log`.
- **fleet-waste** — `--metrics`, `--hours`, `--json`.

`fleet-act` is the only command here that writes, and only with `--apply`:
it appends a request to `fleet-act.audit.jsonl` for a dispatcher consumer and
never interpolates input into a shell. Everything else is read-only. Never put
secrets in `--message` or other argument strings.
