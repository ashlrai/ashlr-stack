import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
const rule = agents.split(/^## /m).find((s) => s.startsWith("Changelog\n"));

test("AGENTS.md states the Unreleased-only changelog rule", () => {
  expect(rule, "no '## Changelog' section in AGENTS.md").toBeDefined();
  expect(rule).toMatch(/may add lines to the `## Unreleased` section/);
  expect(rule).toMatch(/never edit released sections, bump versions or tag/i);
});

test("AGENTS.md no longer bans agent PRs from the changelog", () => {
  expect(agents).not.toMatch(/bridge PRs? (does|do) not edit/i);
});

test("the changelog files the rule names exist", () => {
  for (const path of ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]) {
    expect(existsSync(join(root, path)), path).toBe(true);
  }
});
