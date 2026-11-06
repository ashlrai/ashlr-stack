import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "fast-check.test.mjs"), "utf8");

test("fast-check.test.mjs registers its test with bun:test so bun test executes it", () => {
  expect(source).toMatch(/^import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']bun:test["'];?$/m);
  expect(source).not.toMatch(/from\s*["']node:test["']/);
});
