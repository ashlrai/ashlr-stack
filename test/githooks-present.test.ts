import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";

const hook = new URL("../.githooks/pre-commit", import.meta.url);

test("pre-commit hook exists, has a shebang, and is executable", () => {
  const stats = statSync(hook, { throwIfNoEntry: false });
  expect(stats?.isFile()).toBe(true);
  expect(readFileSync(hook, "utf8").split("\n", 1)[0].startsWith("#!")).toBe(true);
  expect(stats!.mode & 0o111).not.toBe(0);
});

test("setup-hooks configures the repository hooks path", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  expect(manifest.scripts["setup-hooks"]).toContain("core.hooksPath .githooks");
});
