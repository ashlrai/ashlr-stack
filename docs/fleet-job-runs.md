# Fleet job run records

The source core package exports `runJobStages`, `appendJobRunRecord`,
`JOB_RUN_SCHEMA`, and `SYNC_STAGES` from `packages/core/src/fleet/job-run.ts`.
This is a library API, not a CLI command or an automatic integration with a
running Stacksync deployment. Check the installed package version before using it.

`runJobStages` runs supplied stages in order. Each stage receives mutable
`rowsIn` and `rowsOut` counters. A thrown error stops execution, preserves that
stage's partial counts, and marks later stages skipped. The returned
`fleet.job-run.v1` record includes stage timings, overall counts, status, and
the last error. Callers must check `record.status`; stage failures are returned
in the record rather than thrown. Invalid or negative counts become zero.

By default the runner writes one JSON line to stdout. Set `logLine: false` to
silence it, or provide a sink. `tablePath` also appends a JSONL record, creating
parent directories as needed. If that append fails, the returned and logged
record carries `persistError`; there is no persisted record for that attempt.
Errors are flattened and length-limited, but are not redacted. Do not include
secrets or row payloads in error messages or other caller-supplied fields.
A throwing log sink can still reject the call.

`SYNC_STAGES` names the conventional Stacksync stages; callers supply the actual
stage functions. Records describe only runs that use this API.
