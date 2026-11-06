import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

/**
 * Text of the newest version heading: the first `##` heading that opens with a
 * semver, in either style (`## 0.3.0 (2026-10-31)` or `## [0.2.0] — 2026-04-23`).
 * `## Unreleased`, the `#` title and `###` section headings are not versions.
 */
function newestVersionHeading(markdown: string): string | null {
  for (const token of marked.lexer(markdown)) {
    if (
      token.type === "heading" &&
      token.depth === 2 &&
      /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text)
    ) {
      return token.text;
    }
  }
  return null;
}

test("newest version heading matches across source and site changelogs", () => {
  const headings = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"].map((path) => {
    const heading = newestVersionHeading(readFileSync(join(root, path), "utf8"));
    expect(heading, path).not.toBeNull();
    return heading;
  });
  expect(headings[0]).toBe(headings[1]);
});

test("newest-version comparison does not require identical changelogs", () => {
  const source = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "- pending fix",
    "",
    "## 0.3.0 (2026-10-31)",
    "",
    "### Added",
    "",
    "- source-only entry",
    "",
    "## 0.2.2 (2026-10-25)",
    "",
  ].join("\n");
  const published = [
    "# Changelog",
    "",
    "## 0.3.0 (2026-10-31)",
    "",
    "### Added",
    "",
    "- a different body",
    "",
    "## 0.2.1 (2026-10-16)",
    "",
  ].join("\n");
  expect(published).not.toBe(source);
  expect(newestVersionHeading(published)).toBe(newestVersionHeading(source));

  const behind = published.replace("## 0.3.0 (2026-10-31)", "## 0.2.2 (2026-10-25)");
  expect(newestVersionHeading(behind)).not.toBe(newestVersionHeading(source));
});

test("newest version heading extraction handles both heading styles", () => {
  expect(newestVersionHeading("## 0.3.0 (2026-10-31)\n")).toBe("0.3.0 (2026-10-31)");
  expect(newestVersionHeading("## [0.2.0] — 2026-04-23\n")).toBe("[0.2.0] — 2026-04-23");
  expect(newestVersionHeading("## 0.1.0\n")).toBe("0.1.0");
});

test("newest version heading extraction skips non-version headings", () => {
  expect(newestVersionHeading("# 0.3.0\n\n## Unreleased\n")).toBeNull();
  expect(newestVersionHeading("## Unreleased\n\n### 0.3.0\n")).toBeNull();
  expect(newestVersionHeading("## v0.3.0\n")).toBeNull();
  expect(newestVersionHeading("## Unreleased\n\n## 0.3.0 (2026-10-31)\n\n### 0.9.9\n")).toBe(
    "0.3.0 (2026-10-31)",
  );
  expect(newestVersionHeading("## Unreleased\n\n```md\n## 9.9.9\n```\n\n## 0.3.0\n")).toBe("0.3.0");
  expect(newestVersionHeading("")).toBeNull();
});
