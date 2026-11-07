# Fleet job prompts

Fleet queue prompts are external state; this repository has no checked-in job
prompt generator. Use this scaffold when authoring a job, replacing every
bracketed instruction with specifics. It is a starting point, not a guarantee
of a merge. Do not put credentials or other secret values in prompts or notes.

```text
TASK
[Name one user-visible problem and the expected behavior after the change.]

CONTEXT AND SCOPE
[Identify the repository and relevant entry points or evidence. State what is
in scope and an acceptable outcome if the suspected problem is already fixed.]

CONSTRAINTS
[State boundaries, compatibility requirements, and any actions that are not
authorized. Follow the repository's agent and security instructions.]

VERIFICATION
[Give reproducible, relevant tests and checks, including how to report a
blocked or failing check. Define acceptance criteria observable in the result.]

BRIDGE_NOTES.md
[Request a root BRIDGE_NOTES.md with the outcome, evidence, commands and
results, limitations, and any follow-up. Never include secrets.]
```

For example, “improve fleet reliability” leaves the target and success criterion
open. A bounded task could instead ask for a report to distinguish an empty
finish from an unfinished launch, identify the reporting module, and require
fixtures covering both cases. Avoid prescribing a change before checking the
current behavior: if it already meets the criterion, ask for evidence and a
clearly reported no-op rather than an artificial diff.

## Review outcomes without reading values

Use metadata and names only when reviewing job quality. Do not ingest prompt
bodies, notes, log lines, receipt contents, or secret values into a report.
Record a prompt's structural features at authoring time (for example, presence
of task, scope, constraints, verification and notes instructions) and join those
labels to outcome metadata through an approved job identifier. Do not infer a
missing section from a filename. Treat missing or unjoinable records as unknown,
not as failures or as evidence that a section was absent.

Compare cohorts over the same time window and report their sizes, unknowns and
unresolved jobs. `fleet-waste` counts empty finish events and unfinished jobs;
[the outcome trends report](fleet-metrics.md) counts empty publishes and
computes merge yield for published PRs. These are different denominators, and
an empty finish or publish is not by itself proof of a bad prompt: work may
already be complete or blocked. Merge outcomes can arrive later. Use these
signals to choose prompts for a controlled comparison, not to assert causation.
Keep repository, lane, task difficulty and timing in view; change one template
feature at a time and measure a sufficiently resolved cohort before adopting it.
