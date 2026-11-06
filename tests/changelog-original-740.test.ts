import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";
import { inlineLinks, malformedHeadings, sectionEntries, versionBodies, versionSections } from "./changelog-parser-utils";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("repeated-entry fixture keeps both identical entries in their original order", () => {
  const md = read("./__fixtures__/changelog-original-740.md");
  expect(parseChangelog(md)).toEqual([
    { version: null, date: null, entries: ["Repeated entry text.", "Between the two.", "Repeated entry text."] },
    { version: "0.3.0", date: "2026-10-31", entries: ["Repeated entry text.", "Repeated entry text."] },
  ]);
  expect(sectionEntries(md).map((s) => s.entries)).toEqual([
    ["Repeated entry text.", "Between the two.", "Repeated entry text."],
  ]);
});
