import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { malformedHeadings, sectionEntries } from "./changelog-parser-utils";

test("two-section fixture keeps sections and entries in source order (not sorted)", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-two-section-order-original-679.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  expect(sectionEntries(fixture)).toEqual([
    { version: "## 0.2.0 (2026-04-23)", section: "Fixed", entries: ["Fix Z in 0.2.0.", "Fix A in 0.2.0."] },
    { version: "## 0.2.0 (2026-04-23)", section: "Added", entries: ["Add M in 0.2.0.", "Add B in 0.2.0."] },
  ]);
});
