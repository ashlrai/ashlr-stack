# Coordinate Git jobs

Use this source utility when several local jobs share a repository. It requires
Bun and Git. Each command prints JSON on success and exits nonzero on failure.

```sh
bun scripts/git-coordination.ts fetch /path/to/repo
bun scripts/git-coordination.ts worktree /path/to/repo /path/to/job origin/main
bun scripts/git-coordination.ts stage /path/to/job src/changed.ts
```

Fetch first, create one detached worktree per job, then stage changes inside that
job's worktree. Worktree creation never replaces an existing directory. The
explicit repository takes precedence over inherited Git directory/index overrides.

Agents can import `fetchRepository(repo, remote?, options?)`,
`createWorktree(repo, path, ref?, options?)`, and `stageFiles(repo, paths, options?)`
from `git-coordination.ts`. Typed `GitWaitOptions` accepts `timeoutMs` (default
30 seconds) and `onWait`, a callback for observing contention.

Concurrent fetch callers share one successful fetch across linked worktrees and
processes. Later calls fetch again; failed fetches are never cached. Use shared
remote tracking refs such as `origin/main`: `FETCH_HEAD` belongs to each worktree.
Worktree creation is serialized per repository; staging is serialized per
worktree and retries only the specific index-lock conflict until its deadline.

Coordination uses separate `stack-coordination-*` directories and atomic
`stack-fetch-*` receipts under Git's common directory. Only an operation's own
coordination directory is removed when it finishes. Git locks are never removed.
An interrupted coordinator can leave its directory behind; later callers time
out and preserve it. Commands that bypass this utility do not participate in its
coordination. Existing fleet wrappers and read-only inventory commands are unchanged.
