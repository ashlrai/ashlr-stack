import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";
import { inlineLinks, malformedHeadings, sectionEntries, versionBodies, versionSections } from "./changelog-parser-utils";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("whitespace-only fixture file returns no changelog sections from any parser without throwing", () => {
  const md = read("./__fixtures__/changelog-original-731.md");
  expect(md.trim()).toBe("");
  expect(() => {
    parseChangelog(md);
    versionSections(md);
    sectionEntries(md);
    versionBodies(md);
    malformedHeadings(md);
    inlineLinks(md);
  }).not.toThrow();
  expect(parseChangelog(md)).toEqual([]);
  expect(versionSections(md)).toEqual([]);
  expect(sectionEntries(md)).toEqual([]);
  expect(versionBodies(md).size).toBe(0);
  expect(malformedHeadings(md)).toEqual([]);
  expect(inlineLinks(md)).toEqual([]);
});
