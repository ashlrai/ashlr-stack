import { spawnSync } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseWorktreePorcelain } from "./fleet-gc.ts";

/** Allocated bytes, without following symlinks. Errors make the total a lower bound. */
export async function measureWorktree(path: string): Promise<{ bytes: number; complete: boolean }> {
  let bytes = 0;
  let complete = true;
  const pending = [path];
  while (pending.length) {
    const current = pending.pop() as string;
    try {
      const stat = await lstat(current);
      bytes += stat.blocks * 512;
      if (stat.isDirectory()) {
        for (const name of await readdir(current)) pending.push(join(current, name));
      }
    } catch {
      complete = false;
    }
  }
  return { bytes, complete };
}

function git(repo: string, args: string[]) {
  return spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export async function collectWorktreeDisk(repoPath: string, base?: string) {
  const repo = resolve(repoPath);
  const list = git(repo, ["worktree", "list", "--porcelain", "-z"]);
  if (list.status !== 0) throw new Error("Cannot list worktrees for the requested repository");
  const defaultRef = git(repo, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const target = base ?? (defaultRef.status === 0 ? defaultRef.stdout.trim() : "main");
  // Resolve the ref once so a missing base cannot be mistaken for an unmerged branch.
  const targetCommit = git(repo, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${target}^{commit}`,
  ]);
  const commit = targetCommit.status === 0 ? targetCommit.stdout.trim() : null;
  const entries = [];
  for (const worktree of parseWorktreePorcelain(list.stdout)) {
    const size = await measureWorktree(worktree.path);
    const status = git(worktree.path, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
    ]);
    const merged =
      commit && worktree.head
        ? git(repo, ["merge-base", "--is-ancestor", worktree.head, commit])
        : null;
    entries.push({
      path: worktree.path,
      branch: worktree.branch?.replace(/^refs\/heads\//, "") ?? null,
      head: worktree.head,
      bytes: size.bytes,
      complete: size.complete,
      dirty: status.status === 0 ? status.stdout.length > 0 : null,
      merged: merged?.status === 0 ? true : merged?.status === 1 ? false : null,
    });
  }
  entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { schemaVersion: 1 as const, repo, base: target, baseResolved: commit !== null, entries };
}
