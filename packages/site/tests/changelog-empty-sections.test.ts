import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const root = join(import.meta.dir, "../../..");

/**
 * A `##` heading that opens with a semver, in either style
 * (`## 0.3.0 (2026-10-31)` or `## [0.2.0] — 2026-04-23`). `## Unreleased`,
 * the `#` title and `###` section headings are not versions.
 */
function isVersionHeading(token: Token): token is Tokens.Heading {
  return (
    token.type === "heading" &&
    token.depth === 2 &&
    /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text)
  );
}

/**
 * Texts of version headings that open an empty section: only whitespace
 * appears before the next version heading or the end of the file. Any other
 * token — a `###` section heading, a list, a paragraph — counts as content.
 */
function emptyVersionSections(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  const empty: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isVersionHeading(token)) continue;
    let hasContent = false;
    for (let j = i + 1; j < tokens.length && !isVersionHeading(tokens[j]); j++) {
      if (tokens[j].type !== "space") hasContent = true;
    }
    if (!hasContent) empty.push(token.text);
  }
  return empty;
}

test.each(["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"])(
  "%s has no empty version sections",
  (path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    expect(emptyVersionSections(changelog)).toEqual([]);
  },
);

test("empty section detection flags releases without notes", () => {
  expect(
    emptyVersionSections("## 0.2.0\n\n- entry\n\n## 0.1.0\n\n- older\n"),
  ).toEqual([]);
  // Heading followed immediately by the next version heading.
  expect(emptyVersionSections("## 0.2.0\n\n## 0.1.0\n\n- older\n")).toEqual([
    "0.2.0",
  ]);
  // A whitespace-only body still counts as empty.
  expect(
    emptyVersionSections("## 0.2.0\n   \n\t\n## 0.1.0\n\n- older\n"),
  ).toEqual(["0.2.0"]);
  // A trailing release with nothing before the end of the file.
  expect(emptyVersionSections("## 0.2.0\n\n- entry\n\n## 0.1.0\n")).toEqual([
    "0.1.0",
  ]);
  expect(emptyVersionSections("## 0.1.0")).toEqual(["0.1.0"]);
  // Bracketed-style headings are reported verbatim.
  expect(
    emptyVersionSections("## [0.2.0] — date\n\n## 0.1.0\n\n- x\n"),
  ).toEqual(["[0.2.0] — date"]);
  // Every empty section is reported, in file order.
  expect(
    emptyVersionSections("## 0.3.0\n\n## 0.2.0\n\n- x\n\n## 0.1.0\n"),
  ).toEqual(["0.3.0", "0.1.0"]);
  // No version headings at all.
  expect(emptyVersionSections("")).toEqual([]);
  expect(emptyVersionSections("# Changelog\n\n- stray\n")).toEqual([]);
});

test("non-version headings neither open nor bound a version section", () => {
  // `## Unreleased` is not a version heading, so an empty Unreleased block
  // does not fail; the first release is still checked on its own.
  expect(emptyVersionSections("## Unreleased\n\n## 0.1.0\n\n- x\n")).toEqual([]);
  expect(emptyVersionSections("## Unreleased\n\n- wip\n\n## 0.1.0\n")).toEqual([
    "0.1.0",
  ]);
  // A stray `##` heading inside a release is non-whitespace content, so the
  // release is not empty; only the next version heading bounds a section.
  expect(emptyVersionSections("## 0.1.0\n\n## Notes\n")).toEqual([]);
  // A bare `###` subsection heading likewise counts as content.
  expect(emptyVersionSections("## 0.1.0\n\n### Added\n")).toEqual([]);
});

test("fenced code is content and never opens a version section", () => {
  // `## 9.9.9` inside a code fence is not a heading: it neither counts as a
  // version nor bounds the enclosing section, which stays non-empty.
  expect(
    emptyVersionSections(
      "## 0.2.0\n\n```md\n## 9.9.9\n```\n\n## 0.1.0\n\n- x\n",
    ),
  ).toEqual([]);
});
