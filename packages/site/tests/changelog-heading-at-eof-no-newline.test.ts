import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { latestReleaseFromChangelog } from "../scripts/gen-site-facts";

// The final entry is a bare release heading with nothing after it, not even a newline.
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-heading-at-eof-no-newline.md"), "utf8");

test("fixture really ends on the release heading with no trailing newline", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("## 0.1.0 (2026-01-01)")).toBe(true);
});

test("the release lookup retains the final heading", () => {
  expect(latestReleaseFromChangelog(fixture)).toEqual({ version: "0.1.0", date: "2026-01-01", scope: "source-changelog" });
});

test("the lexer keeps the final heading as the last token", () => {
  const last = marked.lexer(fixture).filter((t) => t.type === "heading").at(-1);
  expect(last).toMatchObject({ depth: 2, text: "0.1.0 (2026-01-01)" });
});

test("a trailing newline does not change the result", () => {
  expect(latestReleaseFromChangelog(`${fixture}\n`)).toEqual(latestReleaseFromChangelog(fixture));
});
