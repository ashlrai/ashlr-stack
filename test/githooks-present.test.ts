import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hook = new URL("../.githooks/pre-commit", import.meta.url);

function requireHook(path: string | URL) {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing hook: ${path}`);
  }
}

test("pre-commit hook exists, has a shebang, and is executable", () => {
  requireHook(hook);
  const stats = statSync(hook, { throwIfNoEntry: false });
  expect(stats?.isFile()).toBe(true);
  expect(readFileSync(hook, "utf8").split("\n", 1)[0].startsWith("#!")).toBe(true);
  expect(stats!.mode & 0o111).not.toBe(0);
});

test("a missing hook fails with its path", () => {
  const fixture = mkdtempSync(join(tmpdir(), "stack-hooks-"));
  try {
    const missing = join(fixture, ".githooks", "pre-commit");
    expect(() => requireHook(missing)).toThrow(`Missing hook: ${missing}`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("setup-hooks configures the repository hooks path", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  expect(manifest.scripts["setup-hooks"]).toContain("core.hooksPath .githooks");
});
