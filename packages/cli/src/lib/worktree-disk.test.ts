import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectWorktreeDisk, measureWorktree } from "./worktree-disk.ts";

function git(path: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
}

test("reports ranked worktrees, ancestry, dirty state and missing registrations", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "worktree-disk-")));
  try {
    const repo = join(dir, "repo");
    const other = join(dir, "other");
    const missing = join(dir, "missing");
    await mkdir(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "tracked"), "initial");
    git(repo, "add", "tracked");
    git(repo, "commit", "-m", "initial");
    git(repo, "worktree", "add", "-b", "feature", other);
    await writeFile(join(other, "tracked"), "feature");
    git(other, "commit", "-am", "feature");
    await writeFile(join(other, "untracked"), Buffer.alloc(128 * 1024, 1));
    git(repo, "worktree", "add", "-b", "gone", missing);
    await rm(missing, { recursive: true });
    const cli = spawnSync(
      process.execPath,
      [
        join(import.meta.dir, "../index.ts"),
        "worktree-disk",
        "--repo",
        repo,
        "--base",
        "main",
        "--json",
      ],
      { encoding: "utf8" },
    );
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({
      schemaVersion: 1,
      base: "main",
      baseResolved: true,
    });
    const report = await collectWorktreeDisk(repo, "main");
    expect(report.entries.map((e) => e.bytes)).toEqual(
      report.entries.map((e) => e.bytes).sort((a, b) => b - a),
    );
    expect(report.entries.find((e) => e.path === other)).toMatchObject({
      branch: "feature",
      merged: false,
      dirty: true,
      complete: true,
    });
    expect(report.entries.find((e) => e.path === repo)).toMatchObject({
      branch: "main",
      merged: true,
      dirty: false,
      complete: true,
    });
    expect(report.entries.find((e) => e.path === missing)).toMatchObject({
      bytes: 0,
      complete: false,
      dirty: null,
      merged: true,
    });
    expect(
      (await collectWorktreeDisk(repo, "missing-ref")).entries.every((e) => e.merged === null),
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("does not follow symlinks and marks inaccessible directories incomplete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worktree-size-"));
  const hidden = join(dir, "hidden");
  try {
    await mkdir(hidden);
    await writeFile(join(hidden, "file"), "data");
    await symlink(dir, join(dir, "loop"));
    expect((await measureWorktree(dir)).complete).toBe(true);
    await chmod(hidden, 0);
    expect((await measureWorktree(dir)).complete).toBe(false);
    expect(await measureWorktree(join(dir, "absent"))).toEqual({ bytes: 0, complete: false });
  } finally {
    await chmod(hidden, 0o700);
    await rm(dir, { recursive: true, force: true });
  }
});
