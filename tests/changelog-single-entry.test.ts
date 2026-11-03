import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries, versionSections } from "./changelog-parser-utils";

const fixture = readFileSync(new URL("./__fixtures__/changelog-single-entry.md", import.meta.url), "utf8");

test("single-section, single-entry changelog yields the section and its entry once", () => {
  expect(sectionEntries(fixture)).toEqual([
    { version: "## 0.1.0 (2026-04-19)", section: "Added", entries: ["Only entry."] },
  ]);
  expect(versionSections(fixture)).toHaveLength(1);
});
