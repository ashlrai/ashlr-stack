# Fleet machinery: source map

This is an orientation map for the local Ashlr fleet, not an operating manual
or a specification of a particular host. The executable machinery is outside
this repository under `~/.ashlr-runs/bin/`; its installed version and live
state must be checked on the host. This checkout's existing fleet documentation
is [fleet commands](fleet-commands.md), with a command index in
[cli-command-map.md](cli-command-map.md). Those commands observe the fleet;
they are not the dispatcher itself.

**Verification limit:** the machinery directory was inaccessible when this
map was written. The flow and filenames below identify the requested inspection
points, not verified implementation details. In particular, the tick ordering,
reap triggers, resource admission, exact lane and tier inventory, control-file
semantics, and leader roles require inspection of the installed sources before
relying on them. Do not infer that an absent or unreadable status means idle.

## Lifecycle and inspection points

```text
leader / restock → router and queue → dispatchd tick → launch.sh
                                                    → worktree → lane CLI
                   job state ← reap ← worker exit → publish.sh
```

The diagram is a conceptual map, not proof of execution order or automatic
publication. Start at `~/.ashlr-runs/bin/dispatchd.py` for tick scheduling,
queue selection, admission and reaping. Follow its calls to
`~/.ashlr-runs/bin/launch.sh`, the worktree creation and lane CLI invocation;
then inspect the reap path and `~/.ashlr-runs/bin/publish.sh` for the actual
handoff and failure handling. Inspect `~/.ashlr-runs/bin/router.py` and
`~/.ashlr-runs/bin/restock.sh` for routing, resource accounting and supply.
Check the installed code before assuming retries, cleanup, publication or merge
have occurred. Fork-only pushes use `publish.sh` under [AGENTS.md](../AGENTS.md).

## State visible to Stack

Stack's [`fleet-lanes`](../packages/cli/src/commands/fleet-lanes.ts) reads
`~/.ashlr-runs/queue/slots.json`, `queue.jsonl` and `jobs.jsonl`. It combines
records by job ID, reports lane targets and counts of queued/running jobs, and
checks the existence of `queue/HOLD` without reading its contents. Its idle
reason is a diagnostic derived from those inputs, not a complete model of
dispatch admission. Missing or unreadable inputs can produce unknown values.
[`fleet-graph`](../packages/cli/src/commands/fleet-graph.ts) represents jobs,
pools and repositories and their relationships; its default router input is
`queue/queue.jsonl`. [`fleet-bets`](../packages/cli/src/commands/fleet-bets.ts)
joins the leader ledger `queue/router-queue.md`, `queue/ready.tsv` and outcome
records. [`fleet-supply`](../packages/cli/src/commands/fleet-supply.ts) reads
`dispatchd.log` and `restock-author.log` for aggregate diagnostics.

Lane names, targets, ceilings and tiers are runtime configuration, not an
inventory established by these readers. Use `stack fleet-lanes --json` and
`stack fleet-graph --json` for the fields they expose, then inspect the
installed router and resource configuration for tier definitions and actual
admission rules. The reports do not establish that a lane can launch.

## Holds and services

The named controls to locate in the installed machinery are `HOLD`,
`FILLER_HOLD`, `RESTOCK_OFF`, `LOADGATE_OFF` and `PAUSE`. Only the Stack
reader's `queue/HOLD` existence check is verified here. Their locations,
scope, precedence, and effects on running versus new work are otherwise
unverified; do not create, remove or interpret them by name alone.

Local launch-agent filenames include `~/Library/LaunchAgents/ai.ashlr.dispatchd.plist`,
`ai.ashlr.fleet-leader.plist`, `ai.ashlr.opus-leader.plist`, and
`ai.ashlr.restock-author.plist`. Names alone do not establish their current
commands, enabled state, schedules or responsibilities. Inspect the installed
plist and referenced wrapper without exposing environment values before
attributing a role; leader wrappers and plists are security-pinned.

## Boundaries to preserve

- **Queue and reports:** use identifiers and bounded status fields; never put
  secret values in jobs, messages, arguments, logs or documentation. The
  fleet graph intentionally selects public identifiers and status fields, and
  the lane report does not read HOLD contents. Raw logs and input files are
  not a general redaction boundary.
- **Launch and workers:** preserve the configured sandbox and isolation;
  local model endpoints stay loopback-only. A worktree is not itself proof of
  a sandbox or permission to access unrelated data.
- **Reap and publish:** preserve the secret gates, including `scrub.pl`, the
  secret-shape gate and `publish.sh`; use fork-only pushes through the
  sanctioned publisher. Do not bypass failed or unavailable checks or expose
  private material. A worker exit is not evidence of a published result.
- **Leaders and controls:** keep pinned leader wrappers, prompts, plists and
  sandbox profiles intact. Respect existing holds and the limits in
  [AGENTS.md](../AGENTS.md); do not change a hold based on a diagnostic report.

See [fleet commands](fleet-commands.md) for report inputs and the distinction
between read-only reports and `fleet-act --apply`, which appends a request for
a separate consumer rather than executing it.
