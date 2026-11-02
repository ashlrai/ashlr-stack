import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const DATE = "\\d{4}-\\d{2}-\\d{2}";
/** `## Unreleased`, `## 0.3.0 (DATE)`, `## [0.2.0] — DATE`, `## 0.1.0 — DATE (note)`. */
const VERSION_HEADING = new RegExp(
  `^## (?:Unreleased|(?:\\d+\\.\\d+\\.\\d+|\\[\\d+\\.\\d+\\.\\d+\\]) (?:\\(${DATE}\\)|— ${DATE})(?: \\([^()]+\\))?)$`,
);

/** Returns every level-2 heading that is not well formed (fenced code is ignored). */
export function malformedHeadings(markdown: string): string[] {
  let fenced = false;
  const bad: string[] = [];
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line) && !VERSION_HEADING.test(line)) bad.push(line);
  }
  return bad;
}

test("every CHANGELOG.md version heading is well formed", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  expect(malformedHeadings(changelog)).toEqual([]);
});

test("accepts the heading styles used in the changelog", () => {
  const ok = [
    "## Unreleased",
    "## 0.3.0 (2026-10-31)",
    "## [0.2.0] — 2026-04-23",
    "## 0.1.1 — 2026-04-19",
    "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)",
  ];
  expect(malformedHeadings(ok.join("\n"))).toEqual([]);
});

test("detects malformed version headings in a fixture", () => {
  const fixture = [
    "# Changelog",
    "## Unreleased",
    "## v0.3.0 (2026-10-31)",
    "## 0.3 (2026-10-31)",
    "## 0.2.2 (2026-1-25)",
    "## [0.2.1 — 2026-10-16",
    "## 0.2.0",
    "##0.1.1 (2026-04-19)",
    "## 0.1.0 - 2026-04-19",
    "## 0.0.9 (2026-04-19) trailing",
    "### 0.0.8 sub-heading is ignored",
    "```",
    "## fenced is ignored",
    "```",
    "## 0.0.7 (2026-04-19)",
  ].join("\n");
  expect(malformedHeadings(fixture)).toEqual([
    "## v0.3.0 (2026-10-31)",
    "## 0.3 (2026-10-31)",
    "## 0.2.2 (2026-1-25)",
    "## [0.2.1 — 2026-10-16",
    "## 0.2.0",
    "##0.1.1 (2026-04-19)",
    "## 0.1.0 - 2026-04-19",
    "## 0.0.9 (2026-04-19) trailing",
  ]);
});

test("empty changelog fixture has no malformed headings", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-empty.md", import.meta.url), "utf8");
  expect(() => malformedHeadings(fixture)).not.toThrow();
  expect(malformedHeadings(fixture)).toEqual([]);
});

test("prose before the first version is not a version and the first version stays intact", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-preamble.md", import.meta.url), "utf8");
  const lines = fixture.split("\n");
  const versions = lines.filter((l) => /^## /.test(l));
  expect(malformedHeadings(fixture)).toEqual([]);
  expect(versions).toEqual(["## 0.2.0 (2026-04-23)", "## 0.1.0 (2026-04-19)"]);
  // The first version section starts at its heading and keeps its own body.
  const first = lines.indexOf(versions[0]);
  const second = lines.indexOf(versions[1]);
  expect(lines.slice(first, second).join("\n")).toContain("- First version entry stays intact.");
  // Nothing before it (the preamble) leaks a version-like heading.
  expect(lines.slice(0, first).filter((l) => /^## /.test(l))).toEqual([]);
});
