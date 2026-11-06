import { expect, test } from "bun:test";
import { marked } from "marked";

// Same version-heading rule as tests/changelog.test.ts: `## 1.2.3` or `## [1.2.3]`,
// optionally followed by a date. `## Unreleased` and non-release headings are skipped.
function releaseVersions(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .filter((token) => token.type === "heading" && token.depth === 2)
    .flatMap((heading) => {
      const match = heading.text.match(/^\[?(\d+\.\d+\.\d+)\]?/);
      return match ? [match[1]] : [];
    });
}

test("an empty changelog yields no versions and does not throw", () => {
  expect(releaseVersions("")).toEqual([]);
});

test("whitespace-only and heading-only changelogs yield no versions", () => {
  expect(releaseVersions("\n\n  \n")).toEqual([]);
  expect(releaseVersions("# Changelog\n")).toEqual([]);
  expect(releaseVersions("# Changelog\n\n## Unreleased\n")).toEqual([]);
});

test("the version parser still finds releases in non-empty input", () => {
  expect(releaseVersions("# Changelog\n\n## Unreleased\n\n## [0.2.0] — d\n\n## 0.1.0 (d)\n")).toEqual(["0.2.0", "0.1.0"]);
});
