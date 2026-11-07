# Fleet outcome trends

Run from a Stack checkout with Bun:

```sh
bun scripts/fleet-metrics.ts 2026-01-01T00:00:00Z 2026-01-08T00:00:00Z
# Optional third argument: path to a different jobs.jsonl
```

The read-only JSON report groups event counts by lane and repo, using `unknown` when a name is missing or invalid. Both window endpoints are inclusive. `finish` and `reap` events count as reaps. Counts are events, so repeated events count repeatedly. Compare equal-length windows to see trends.

Merge yield is the number of distinct PR URLs published by a group in the window that have a `MERGED` outcome by the window end, divided by distinct PR URLs published by that group in the window. It is null with no PRs. Outcomes are joined by URL regardless of file order; outcomes after the window are excluded. Open PRs remain in the denominator, so recent cohorts can have an understated yield. A URL published in multiple groups contributes to each group. Rows without a PR URL do not enter the denominator.

Failure signatures are fixed categories: precheck skips, empty finishes/reaps, empty publishes, and publish errors. They count events and can overlap across a job; they do not expose error text, codes, job IDs, or URLs. Lane and repo are input metadata and should themselves contain no secrets. Unrecognized events are ignored; recognized events with invalid timestamps are counted separately. The report requires explicit ISO timestamps with a timezone and a complete, valid JSONL regular file of at most 32 MiB; missing, malformed, oversized, or symlink sources fail rather than presenting partial results as complete.
