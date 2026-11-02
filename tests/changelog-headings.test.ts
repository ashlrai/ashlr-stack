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
