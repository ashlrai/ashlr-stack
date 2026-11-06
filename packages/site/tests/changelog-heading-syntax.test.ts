import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

/**
 * Canonical grammar for a `##` release heading: a bare or bracketed semver,
 * then either ` (YYYY-MM-DD)` or ` — YYYY-MM-DD`, then an optional
 * parenthesized note. The four shapes in use:
 * `## 0.3.0 (2026-10-31)`, `## 0.1.1 — 2026-04-19`,
 * `## [0.2.0] — 2026-04-23`, `## 0.1.0 — 2026-04-19 (superseded by 0.1.1)`.
 * Brackets must balance: `[0.4.0 — date` and `0.4.0] — date` are malformed.
 */
const VERSION_HEADING =
  /^(?:\d+\.\d+\.\d+|\[\d+\.\d+\.\d+\])(?: \(\d{4}-\d{2}-\d{2}\)| — \d{4}-\d{2}-\d{2})(?: \([^()]+\))?$/;

/**
 * `##` heading texts that open like a release without parsing as one: a `v`
 * prefix (`v0.4.0`), a partial semver (`0.4`), a prerelease (`0.4.0-beta.1`),
 * a bracket that never closes, or a `Release`/`Version` label. They evade
 * every version-scoped check — ordering, dates, duplicates, empty sections —
 * so the syntax gate reports them as malformed.
 */
function isReleaseShaped(text: string): boolean {
  return (
    /^v\[?\d/.test(text) ||
    /^v?\[?\d+\.\d/.test(text) ||
    /^(?:release|version)\b[^a-z]*\d/i.test(text)
  );
}

/**
 * Heading texts that break the release grammar: `##` headings that open like a
 * version but fail VERSION_HEADING, plus headings at any other depth whose
 * text matches VERSION_HEADING exactly — a release heading written at the
 * wrong level. `## Unreleased`, the `#` title and `###` section headings are
 * ignored.
 */
function malformedVersionHeadings(markdown: string): string[] {
  const malformed: string[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading") continue;
    const canonical = VERSION_HEADING.test(token.text);
    if (token.depth === 2 ? isReleaseShaped(token.text) && !canonical : canonical) {
      malformed.push(token.text);
    }
  }
  return malformed;
}

test.each(["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"])(
  "every release heading in %s uses canonical version syntax",
  (path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    expect(malformedVersionHeadings(changelog)).toEqual([]);
  },
);

test.each([
  "0.4.0 (2026-11-01)",
  "0.4.0 — 2026-11-01",
  "0.4.0 — 2026-11-01 (superseded by 0.4.1)",
  "[0.4.0] — 2026-11-01",
  "[0.4.0] (2026-11-01)",
])("accepts canonical release heading %j", (text) => {
  expect(malformedVersionHeadings(`## ${text}\n\n- entry\n`)).toEqual([]);
});

test.each([
  "0.4.0",
  "0.4.0 2026-11-01",
  "0.4.0 - 2026-11-01",
  "0.4.0 (October 31, 2026)",
  "0.4.0 (2026-11-01",
  "[0.4.0 — 2026-11-01",
  "0.4.0] — 2026-11-01",
  "[0.4.0] 2026-11-01",
  "v0.4.0 (2026-11-01)",
  "v4",
  "0.4 (2026-11-01)",
  "0.4.0-beta.1 (2026-11-05)",
  "Release 0.4.0",
  "0.4.0 — 2026-11-01 (superseded",
  "0.4.0 — 2026-11-01 — extra",
  "0.4.0 (2026-11-01) trailing",
])("flags malformed release heading %j", (text) => {
  expect(malformedVersionHeadings(`## ${text}\n\n- entry\n`)).toEqual([text]);
});

test("every malformed heading is reported in file order", () => {
  const markdown = [
    "# Changelog",
    "",
    "## 0.4.0",
    "",
    "- entry",
    "",
    "## 0.3.0 (2026-10-31)",
    "",
    "- entry",
    "",
    "## v0.2.0",
    "",
  ].join("\n");
  expect(malformedVersionHeadings(markdown)).toEqual(["0.4.0", "v0.2.0"]);
});

test("canonical release text at the wrong heading depth is flagged", () => {
  const markdown = "# 0.4.0 (2026-11-01)\n\n## 0.3.0 (2026-10-31)\n\n### 0.2.0 — 2026-04-23\n";
  expect(malformedVersionHeadings(markdown)).toEqual([
    "0.4.0 (2026-11-01)",
    "0.2.0 — 2026-04-23",
  ]);
});

test("non-release ## headings and fenced text are ignored", () => {
  const markdown = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "## Notes on migration",
    "",
    "## 2026-11-01 retrospective",
    "",
    "```md",
    "## v9.9.9",
    "### 9.9.9 (2026-01-01)",
    "```",
    "",
    "## 0.3.0 (2026-10-31)",
    "",
    "- entry",
    "",
  ].join("\n");
  expect(malformedVersionHeadings(markdown)).toEqual([]);
});
