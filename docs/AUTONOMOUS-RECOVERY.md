# Autonomous fleet recovery

This is an operator runbook and implementation proposal, not an installation or
permission to bypass admission. It describes the Stack checkout and the Phantom
source available during this investigation; verify the installed `phm`/`ashlr`
command's `--help` and version before acting. The local `~/.ashlr-runs/bin`
scripts were inaccessible here, so their implementation and the live fleet state
were not verified. In particular, no router refresh command or unattended
resident restart is established by this checkout. Do not guess either one.

Start with `phm pool admission --json`, `phm daemon status --json`,
`ashlr fleet resources --json`, `ashlr fleet worktrees --json`, and
`stack fleet-lanes --json` where those installed commands are available. Record
UTC observation time, source health, lane, last successful update, gate reasons,
and action/result without raw logs, credentials or provider account data.
Unknown, unreadable or stale evidence is not evidence of spare capacity. Recheck
all admission reasons after each action: fixing one does not clear the others.
Stack's `fleet-lanes` uses its own slots, queue and jobs projections; missing
sources yield unknown counts. Its `fleet-act` previews by default; `--apply`
only appends a request to an outbox, and does not prove a dispatcher consumed or
executed it ([fleet commands](fleet-commands.md)).

## Stale daemon tick

**Detect.** Phantom's `src/core/queue/admission.ts` reports
`daemon_tick_stale` when the last tick exceeds 900 seconds; unavailable status
is a separate blocking reason. A 12-hour age is an incident observation, not a
configured timeout. Inspect `phm daemon status --json`, including `.tick`
(`lastTickAt`, `outcome`, `phases`, and in-flight phase where provided), process
and service status, and the gate. A long-running tick is not necessarily dead:
the documented whole-tick backstop is 60 minutes, and a timed-out phase can
remain detached. The newer daemon records timeout/failure and refuses another
tick while an abandoned tick remains open. Verify the installed version has
these protections; an advancing timestamp alone does not prove useful work.

**Recover.** Allow a bounded tick to settle; inspect timeout/degraded phases
and repair the specific unpinned dependency through its supported owner. If a
resident is wedged or `refused-open` persists, propose the native resident
restart after checking singleton ownership, live child work, Stop and standing
authority. Phantom's `docs/RESIDENT-RUNTIME.md` identifies
`ashlr authority resident start` as the admitted install/restart path, with
checks including a clean build, active grant and Stop off. That document calls
for an operator terminal or a confirmed native restart; unattended use is not
verified here. Do not kill by guessed PID, delete a lock, clear Stop, edit a
plist/wrapper, or start a second daemon. An agent should prepare the exact
service identity and evidence and use an already-authorized native path if its
installed contract permits it; otherwise hand off that concrete restart. Check
new tick timestamps, phase outcomes and admission after recovery, and follow up
on detached work rather than assuming it stopped.

**Proposal.** Add a bounded, singleton-aware supervisor using the sanctioned
resident lifecycle, with deduplication, audit, child reconciliation and tests
for hangs, stale owners and restart loops. This document does not implement it.
Source: Phantom `docs/daemon-tick-phases.md` and
`docs/contracts/CONTRACT-M24.md`.

## Stale or understated resource readings

**Detect.** `ashlr fleet resources --json` reads `queue/slots.json` and
`queue/resources.json`: `used_frac >= 1` is reported skipped; missing entries
on targeted lanes are unseen. The report exposes no reading timestamp, and a
healthy file only means it parsed. Compare each lane's trusted observation time,
reset and provider/account identity with a fresh authorized usage reading and
with the writer's health. Zai/Grok/Cursor at 1.0 since November 4 are a clue,
not proof of a reset. A missing entry is especially unsafe as the documented
router fallback is 0.5. For codex-cmp distinguish used fraction, quota limit and
concurrency target/ceiling; a low reported capacity cannot be corrected by
inventing a usage fraction or raising slots.

**Recover.** Identify the actual installed writer and its ownership, schedule,
locking and mapping before invoking its supported refresh. Feed it fresh,
account-specific, authorized evidence; compare the resulting router row and
observation time, then rerun admission and observe a normal dispatch. Do not
edit or delete resource rows to force a lane open. If a reader or writer is
missing, broken or cannot prove freshness, preserve the hold and route work to
other eligible lanes; propose repairing the integration. Phantom's
`docs/USAGE-SIGNALS.md` describes a separate `fleet.json` usage store and a
`--status-readers --dry-run` for CMP and Claude with an explicit CMP pool home;
it does **not** establish that this updates `queue/resources.json`. Other pools
need their own authorized readers. Do not read or modify `~/.codex` auth, copy
browser credentials, sign in, or mix CMP with personal account evidence.

**Proposal.** Implement or repair a single guarded router writer with per-lane
source, account, observed-at and reset metadata, atomic/locked updates, stale
expiry that cannot turn unknown into spare capacity, and tests for stale,
missing, reordered and cross-account readings. Verify the provider's actual
cap independently before any supported target adjustment; retain existing hard
caps, budgets and admission checks.

## Accumulated worktrees

**Detect.** Phantom's admission mirror blocks above 40 worktrees; 695 is an
incident snapshot, not a deletion list. `ashlr fleet worktrees --json` reports
size, directory age and merged evidence under `~/Projects/ashlrai/wt` by
default. Unknown source/size or an old directory does not establish safety.
`ashlr fleet wt-reap --json` instead previews `~/.ashlr-runs/wt`: its candidates
have a recorded merged outcome or an empty finish, and a finish older than one
hour. These are different roots; do not assume that the reaper cleans the 695.

**Recover.** Inventory the actual admission-counted root and compare against
active jobs, claims, processes, open PRs and Git worktree registrations. Protect
this worktree, active/unknown/open work, dirty or untracked content, ignored
valuable files, unpublished commits and non-job directories. For the reaper's
own root, inspect its preview and the installed implementation first; the
reviewed version rechecks direct-child real paths, requires readable sources,
and uses `git worktree remove` without force. Its parser skips malformed log
rows and does not itself prove absence of ignored data or live jobs, so those
checks still matter. Only after individually verifying every candidate may the
leader run `ashlr fleet wt-reap --apply --json`; it operates on all candidates,
not a selected ID. If any candidate is uncertain, do not use the bulk apply.
For the other root, use a separately verified per-worktree Git removal procedure
only after the same checks; never `rm -rf`, force removal, or prune based solely
on age. Recount and recheck admission; preserve failures for investigation.

**Proposal.** Extend a guarded reaper to the actual counted root with live-job
and Git/ignored-file checks, explicit per-candidate selection, dry-run, atomic
revalidation and audited results. Test race and incomplete-evidence cases.
Source: Phantom `src/cli/fleet-worktrees.ts`, `fleet-wt-reap.ts` and
`src/core/queue/admission.ts`.

## Lanes parked for rate resets

**Detect.** Compare lane holds and provider reset evidence, including source
health, reading time, hold owner and reset time. A lane may instead be manually
held, at a ceiling, out of work, or blocked by a global gate. Do not treat a
past guessed reset or an outbox request as proof of a successful launch.

**Recover.** On a version exposing it, preview
`ashlr fleet reset-release --json`; then run
`ashlr fleet reset-release --apply --json` for one guarded reconciliation. The reviewed Phantom implementation
requires healthy sources and releases only `autobackoff` holds classified
`reset-detected`, `reset-time-passed`, or `hold-expired`; the write rechecks hold
ownership, so manual holds remain. It records releases, but an audit append can
fail after the release: inspect both `released` and `errors` and reconcile
before retrying. This command may release every eligible lane, so inspect the
whole preview and current conditions first. Check hold state, fresh resource
reading, queue and subsequent admission/dispatch. The desktop-triggered loop is
process-local and opt-in; do not assume it survives a restart. If evidence is
unhealthy, repair the reader or wait for a new observation, then retry; never
clear a manual hold or bypass a budget to test a reset. Source: Phantom
`src/cli/fleet-reset-release.ts` and `src/core/fleet/usage-reset-release.ts`.

## Authority boundaries

Mason is required for passwords, Touch ID/2FA or device approvals, payments,
new spending and billing changes. `~/.codex` authentication changes are
prohibited. Security GATES v3 pinned files (including secret gates,
`publish.sh`, sandbox profiles, leader wrappers/prompts/plists, and the MACCU
TCC helper and loopback auth) are outside autonomous modification; follow the
applicable pin process rather than editing them. Preserve explicit holds,
standing-authority and Stop checks, and never expose secrets. If the OS denies
access to a needed local reference, report the access limitation and hand off
the concrete missing inspection; do not interpret denial as permission to
bypass it.
