import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";
import { inlineLinks, malformedHeadings, sectionEntries, versionBodies, versionSections } from "./changelog-parser-utils";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("numbered-version fixture parses the heading and its entry into the expected section", () => {
  const md = read("./__fixtures__/changelog-original-746.md");
  expect(parseChangelog(md)).toEqual([
    { version: "1.2.3", date: "2026-11-03", entries: ["Numbered-version entry for 1.2.3."] },
  ]);
  expect(sectionEntries(md)).toEqual([
    { version: "## 1.2.3 (2026-11-03)", section: "Added", entries: ["Numbered-version entry for 1.2.3."] },
  ]);
  expect(malformedHeadings(md)).toEqual([]);
});
