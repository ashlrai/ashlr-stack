import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const doc = read("docs/changelog-format.md");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const changelogs = paths.map(read);

// Heading examples the guide quotes: `#`/`##`/`###` tokens in inline code spans
// and heading lines inside fenced code blocks. Shape templates such as
// `## <version> (<date>)` are not quotes, so tokens containing < or > are
// skipped.
function quotedHeadings(markdown: string): string[] {
  const quoted = new Set<string>();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    if (/^#{1,3} /.test(match[1]) && !/[<>]/.test(match[1])) quoted.add(match[1]);
  }
  for (const match of markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of match[1].split("\n")) {
      const trimmed = line.trim();
      if (/^#{1,3} /.test(trimmed) && !/[<>]/.test(trimmed)) quoted.add(trimmed);
    }
  }
  return [...quoted];
}

// Quoted headings that do not appear as verbatim lines in a changelog.
function missingExamples(doc: string, changelog: string): string[] {
  const lines = new Set(changelog.split("\n"));
  return quotedHeadings(doc).filter((heading) => !lines.has(heading));
}

function releaseHeadings(changelog: string): string[] {
  return changelog
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));
}

test("format guide names and links both changelog copies", () => {
  expect(doc).toContain("](../CHANGELOG.md)");
  expect(doc).toContain("](../packages/site/src/data/CHANGELOG.md)");
  expect(doc).toContain("Unreleased");
});

test("guide quotes at least six real version headings", () => {
  const versioned = quotedHeadings(doc).filter((heading) => /^## \[?\d/.test(heading));
  expect(versioned.length).toBeGreaterThanOrEqual(6);
});

test.each(paths)("every quoted heading is a verbatim line in %s", (path) => {
  expect(missingExamples(doc, read(path))).toEqual([]);
});

test("missing-examples check reports absent headings and skips shape templates", () => {
  const changelog = "# Changelog\n\n## Unreleased\n\n## 0.1.0 (2026-01-01)\n";
  expect(missingExamples("`## 0.1.0 (2026-01-01)`", changelog)).toEqual([]);
  expect(missingExamples("`## 9.9.9 (2030-01-01)`", changelog)).toEqual(["## 9.9.9 (2030-01-01)"]);
  expect(missingExamples("```text\n## 9.9.9\n```", changelog)).toEqual(["## 9.9.9"]);
  expect(missingExamples("`## <version> (<date>)`", changelog)).toEqual([]);
});

test("the descending ordering the guide describes holds in both changelogs", () => {
  for (const changelog of changelogs) {
    const headings = releaseHeadings(changelog);
    expect(headings[0]).toBe("Unreleased");
    const versions = headings.slice(1).map((heading) => {
      const match = heading.match(/^\[?(\d+)\.(\d+)\.(\d+)\]?/);
      expect(match).not.toBeNull();
      return (match ?? []).slice(1).map(Number);
    });
    for (let i = 1; i < versions.length; i++) {
      const previous = versions[i - 1];
      const current = versions[i];
      const firstDifference = previous.findIndex((part, index) => part !== current[index]);
      expect(firstDifference).toBeGreaterThanOrEqual(0);
      expect(previous[firstDifference]).toBeGreaterThan(current[firstDifference]);
    }
  }
});

test("the two changelog copies are identical, as the guide states", () => {
  expect(changelogs[0]).toBe(changelogs[1]);
});
