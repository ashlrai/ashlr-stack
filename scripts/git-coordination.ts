import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
export interface GitWaitOptions {
  timeoutMs?: number;
  onWait?: () => void;
}

async function git(repo: string, args: string[], timeout = 30_000) {
  return (
    await exec("git", ["-C", repo, ...args], {
      timeout,
      encoding: "utf8",
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_COMMON_DIR: undefined,
        GIT_INDEX_FILE: undefined,
      },
    })
  ).stdout.trim();
}

async function coordinate<T>(
  repo: string,
  scope: string,
  options: GitWaitOptions,
  action: (remaining: () => number) => Promise<T>,
) {
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("timeoutMs must be positive");
  const deadline = Date.now() + timeout;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new Error("Timed out waiting for Git; existing locks were preserved");
    return ms;
  };
  const common = await realpath(
    resolve(repo, await git(repo, ["rev-parse", "--git-common-dir"], remaining())),
  );
  const lock = join(common, `stack-coordination-${scope}`);
  for (;;) {
    remaining();
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      options.onWait?.();
      await delay(Math.min(25, remaining()));
    }
  }
  try {
    return await action(remaining);
  } finally {
    await rmdir(lock);
  } // Only the directory acquired by this call; never a Git lock.
}

const key = (value: string) => createHash("sha256").update(value).digest("hex");
async function receipt(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

/** Concurrent callers across linked worktrees share one successful fetch, including across processes. */
export async function fetchRepository(
  repo: string,
  remote = "origin",
  options: GitWaitOptions = {},
) {
  const common = await realpath(resolve(repo, await git(repo, ["rev-parse", "--git-common-dir"])));
  const stamp = join(common, `stack-fetch-${key(remote)}`);
  const before = await receipt(stamp);
  return coordinate(repo, "fetch", options, async (remaining) => {
    if ((await receipt(stamp)) !== before) return { fetched: false };
    await git(repo, ["fetch", "--no-auto-maintenance", "--", remote], remaining());
    const next = `${stamp}-${randomUUID()}`;
    try {
      await writeFile(next, randomUUID(), { flag: "wx" });
      await rename(next, stamp);
    } finally {
      await rm(next, { force: true });
    }
    return { fetched: true };
  });
}

/** Detached checkouts keep each job's index and working files separate. */
export async function createWorktree(
  repo: string,
  path: string,
  ref = "HEAD",
  options: GitWaitOptions = {},
) {
  return coordinate(repo, "worktrees", options, async (remaining) => {
    await git(repo, ["worktree", "add", "--detach", "--", resolve(path), ref], remaining());
    return { path: resolve(path) };
  });
}

/** Retry only Git's pre-write index-lock conflict; never remove another process's lock. */
export async function stageFiles(repo: string, paths: string[], options: GitWaitOptions = {}) {
  if (!paths.length) throw new Error("Provide at least one path to stage");
  const index = await realpath(resolve(repo, await git(repo, ["rev-parse", "--git-dir"])));
  return coordinate(repo, `index-${key(index)}`, options, async (remaining) => {
    for (;;) {
      try {
        await git(repo, ["add", "--", ...paths], remaining());
        return;
      } catch (error) {
        remaining();
        if (
          !(
            error instanceof Error &&
            "stderr" in error &&
            /Unable to create .*index\.lock.*File exists/s.test(String(error.stderr))
          )
        )
          throw error;
        options.onWait?.();
        await delay(Math.min(25, remaining()));
      }
    }
  });
}

if (import.meta.main) {
  const [command, repo, ...args] = process.argv.slice(2);
  try {
    if (!repo) throw new Error("missing repository");
    if (command === "fetch") console.log(JSON.stringify(await fetchRepository(repo, args[0])));
    else if (command === "worktree" && args[0])
      console.log(JSON.stringify(await createWorktree(repo, args[0], args[1])));
    else if (command === "stage") {
      await stageFiles(repo, args);
      console.log('{"staged":true}');
    } else throw new Error("unknown command");
  } catch {
    console.error(
      "Git operation failed. Usage: bun scripts/git-coordination.ts fetch <repo> [remote] | worktree <repo> <path> [ref] | stage <repo> <paths...>. Existing locks are preserved.",
    );
    process.exitCode = 1;
  }
}
