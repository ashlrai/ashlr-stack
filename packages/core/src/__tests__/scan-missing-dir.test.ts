import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSource } from "../detect-source.ts";
import { SourceDirectoryNotFoundError } from "../errors.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "stack-scan-missing-"));
  roots.push(root);
  return root;
}

test("a missing directory fails with a typed error without being created", async () => {
  const path = join(makeRoot(), "missing", "project");
  try {
    await scanSource(path);
    throw new Error("expected scanSource to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(SourceDirectoryNotFoundError);
    expect((error as SourceDirectoryNotFoundError).code).toBe("SOURCE_DIRECTORY_NOT_FOUND");
    expect((error as Error).message).toContain(path);
  }
  expect(existsSync(path)).toBe(false);
  expect(existsSync(join(path, ".."))).toBe(false);
});

test("a file path and a path beneath a file fail with the typed error", async () => {
  const path = join(makeRoot(), "file");
  writeFileSync(path, "unchanged");
  await expect(scanSource(path)).rejects.toBeInstanceOf(SourceDirectoryNotFoundError);
  await expect(scanSource(join(path, "child"))).rejects.toBeInstanceOf(
    SourceDirectoryNotFoundError,
  );
  expect(readFileSync(path, "utf8")).toBe("unchanged");
});

test("an empty directory still has no detections", async () => {
  expect(await scanSource(makeRoot())).toEqual([]);
});
