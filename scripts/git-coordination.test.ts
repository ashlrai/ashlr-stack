import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createWorktree, fetchRepository, stageFiles } from "./git-coordination.ts";
const exec = promisify(execFile);
let root: string;
let repo: string;
const children: ReturnType<typeof Bun.spawn>[] = [];
const git = async (path: string, ...args: string[]) =>
  (await exec("git", ["-C", path, ...args])).stdout.trim();
async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Fixture barrier timed out");
    await delay(10);
  }
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "git-contention-")));
  repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.name", "Test");
  await git(repo, "config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "tracked"), "initial\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
});
afterEach(async () => {
  await writeFile(join(root, "index-release"), "release");
  await writeFile(join(root, "fetch-release"), "release");
  for (const child of children.splice(0)) {
    const timer = setTimeout(() => child.kill(), 1000);
    try {
      await child.exited;
    } finally {
      clearTimeout(timer);
    }
  }
  await rm(root, { recursive: true, force: true });
});

// An actual Git child owns index.lock until its clean filter returns.
async function holdIndex() {
  const filter = join(root, "filter.ts");
  await writeFile(
    filter,
    `import { existsSync, writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(root, "index-ready"))}, 'ready');
while (!existsSync(${JSON.stringify(join(root, "index-release"))})) await Bun.sleep(10);
process.stdout.write(await Bun.stdin.text());`,
  );
  await git(repo, "config", "filter.hold.clean", `'${process.execPath}' '${filter}'`);
  await writeFile(join(repo, ".gitattributes"), "tracked filter=hold\n");
  await writeFile(join(repo, "tracked"), "owner\n");
  const child = Bun.spawn(["git", "-C", repo, "add", "tracked"], {
    stdout: "ignore",
    stderr: "pipe",
  });
  children.push(child);
  await until(() => existsSync(join(root, "index-ready")));
  return child;
}

test("real index contention retries after its owner exits; linked worktrees stay independent", async () => {
  const [a, b] = await Promise.all([
    createWorktree(repo, join(root, "a")),
    createWorktree(repo, join(root, "b")),
  ]);
  const owner = await holdIndex();
  const lock = join(repo, ".git", "index.lock");
  const inode = (await stat(lock)).ino;
  await expect(git(repo, "add", ".gitattributes")).rejects.toThrow("index.lock");
  let waits = 0;
  const pending = stageFiles(repo, [".gitattributes"], {
    onWait: () => {
      waits++;
    },
  });
  await until(() => waits > 0);
  await writeFile(join(a.path, "tracked"), "a\n");
  await writeFile(join(b.path, "tracked"), "b\n");
  await Promise.all([stageFiles(a.path, ["tracked"]), stageFiles(b.path, ["tracked"])]);
  expect(await git(a.path, "show", ":tracked")).toBe("a");
  expect(await git(b.path, "show", ":tracked")).toBe("b");
  expect((await stat(lock)).ino).toBe(inode);
  await writeFile(join(root, "index-release"), "release");
  expect(await owner.exited).toBe(0);
  await pending;
  expect(await git(repo, "diff", "--cached", "--name-only")).toBe(".gitattributes\ntracked");
});

test("deadline preserves a live index lock and later calls recover", async () => {
  const owner = await holdIndex();
  const lock = join(repo, ".git", "index.lock");
  const inode = (await stat(lock)).ino;
  await expect(stageFiles(repo, [".gitattributes"], { timeoutMs: 200 })).rejects.toThrow(
    "Timed out",
  );
  expect((await stat(lock)).ino).toBe(inode);
  await writeFile(join(root, "index-release"), "release");
  expect(await owner.exited).toBe(0);
  await stageFiles(repo, [".gitattributes"]);
  await expect(stageFiles(repo, ["missing"])).rejects.toThrow("pathspec");
  await stageFiles(repo, ["tracked"]);
});

test("fetches coalesce across processes and linked worktrees, then failures release coordination", async () => {
  const other = await createWorktree(repo, join(root, "other"));
  await git(repo, "remote", "add", "origin", repo);
  const upload = join(root, "upload.ts");
  await writeFile(
    upload,
    `import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(root, "fetch-count"))}, 'fetch\\n');
writeFileSync(${JSON.stringify(join(root, "fetch-ready"))}, 'ready');
while (!existsSync(${JSON.stringify(join(root, "fetch-release"))})) await Bun.sleep(10);
process.exit(Bun.spawnSync(['git', 'upload-pack', ...process.argv.slice(2)], {stdin:'inherit',stdout:'inherit',stderr:'inherit'}).exitCode);`,
  );
  await git(repo, "config", "remote.origin.uploadpack", `'${process.execPath}' '${upload}'`);
  const first = fetchRepository(repo);
  await until(() => existsSync(join(root, "fetch-ready")));
  const worker = join(root, "worker.ts");
  await writeFile(
    worker,
    `import { writeFileSync } from 'node:fs';
import { fetchRepository } from ${JSON.stringify(join(import.meta.dir, "git-coordination.ts"))};
console.log(JSON.stringify(await fetchRepository(${JSON.stringify(other.path)}, 'origin', {
onWait: () => writeFileSync(${JSON.stringify(join(root, "fetch-waiting"))}, 'waiting') })));`,
  );
  const child = Bun.spawn([process.execPath, worker], { stdout: "pipe", stderr: "pipe" });
  children.push(child);
  await until(() => existsSync(join(root, "fetch-waiting")));
  await expect(fetchRepository(other.path, "origin", { timeoutMs: 100 })).rejects.toThrow(
    "Timed out",
  );
  expect(existsSync(join(repo, ".git", "stack-coordination-fetch"))).toBe(true);
  await writeFile(join(root, "fetch-release"), "release");
  expect(await first).toEqual({ fetched: true });
  expect(await child.exited).toBe(0);
  expect(JSON.parse(await new Response(child.stdout).text())).toEqual({ fetched: false });
  expect(await readFile(join(root, "fetch-count"), "utf8")).toBe("fetch\n");
  expect(await git(other.path, "rev-parse", "origin/main")).toBe(
    await git(repo, "rev-parse", "HEAD"),
  );
  await git(repo, "remote", "set-url", "origin", join(root, "missing"));
  await expect(fetchRepository(repo)).rejects.toThrow();
  await git(repo, "remote", "set-url", "origin", repo);
  expect(await fetchRepository(repo)).toEqual({ fetched: true });
});

test("worktree failures release coordination, CLI returns JSON and options are bounded", async () => {
  await expect(createWorktree(repo, join(root, "bad"), "missing-ref")).rejects.toThrow();
  const cli = await exec(process.execPath, [
    join(import.meta.dir, "git-coordination.ts"),
    "worktree",
    repo,
    join(root, "cli"),
  ]);
  expect(JSON.parse(cli.stdout)).toEqual({ path: join(root, "cli") });
  await writeFile(join(root, "cli", "tracked"), "cli change\n");
  await exec(
    process.execPath,
    [join(import.meta.dir, "git-coordination.ts"), "stage", join(root, "cli"), "tracked"],
    {
      env: {
        ...process.env,
        GIT_DIR: join(repo, ".git"),
        GIT_WORK_TREE: repo,
        GIT_INDEX_FILE: join(root, "ambient-index"),
      },
    },
  );
  expect(existsSync(join(root, "ambient-index"))).toBe(false);
  expect(await git(join(root, "cli"), "show", ":tracked")).toBe("cli change");
  expect(await git(repo, "show", ":tracked")).toBe("initial");
  await expect(stageFiles(repo, [])).rejects.toThrow("at least one");
  await expect(
    createWorktree(repo, join(root, "never"), "HEAD", { timeoutMs: Number.POSITIVE_INFINITY }),
  ).rejects.toThrow("positive");
});
