# Worktree disk report

Run `stack worktree-disk` inside a Git repository to rank its registered worktrees by allocated disk bytes. Use `--repo <path>` to select another repository and `--json` for the versioned, machine-readable report. The command only reads local files and Git state; it does not delete worktrees or fetch remote changes.

The merge target defaults to the local `origin/HEAD` reference, falling back to `main`. Use `--base <ref>` to choose another target. Merged means the worktree's recorded HEAD is an ancestor of that target, not that a pull request was merged. The target is local and may be stale. Dirty includes tracked changes and untracked files, following Git's ignore rules. Either state is `null` in JSON when it cannot be determined.

Sizes sum filesystem allocated blocks, including ignored files, directory metadata and each worktree's `.git` entry. The main worktree usually includes the shared Git object store; linked worktrees do not. Symlinks are counted but not followed, and hard links are counted for each directory entry. Sizes are estimates, not guaranteed reclaimable space. An incomplete scan is marked with `+` in text and `complete: false` in JSON; its bytes are a lower bound. Missing registered paths are included with an incomplete size and unknown dirty state.
