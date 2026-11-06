import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const agents = readFileSync(join(root, "AGENTS.md"), "utf8");

// Each of these files appears in 10 or 11 of the 30 newest open PRs, so
// bridge jobs must not edit them. Matched as backticked spans so the bare
// `CHANGELOG.md` reference cannot be satisfied by the site-data path tail.
const hotFiles = [
  "CHANGELOG.md",
  "packages/site/src/data/CHANGELOG.md",
  "packages/site/tests/changelog.test.ts",
];

const sections = agents.split(/^## /m).slice(1);
const rule = sections.find((section) => hotFiles.every((path) => section.includes(`\`${path}\``)));

test("AGENTS.md carries a section naming all three hot files", () => {
  expect(rule, "no AGENTS.md section names all three hot files").toBeDefined();
  expect(rule?.split("\n", 1)[0]).toMatch(/hot file|bridge/i);
});

test("the rule bars bridge PRs from editing the hot files and routes entries to the notes", () => {
  expect(rule).toMatch(/bridge PR does not edit|bridge PRs do not edit/i);
  expect(rule).toMatch(/notes carry the entry/i);
  expect(rule).toContain("`BRIDGE_NOTES.md`");
});

test("every file the rule protects exists in the repo", () => {
  for (const path of hotFiles) {
    expect(existsSync(join(root, path)), path).toBe(true);
  }
});
