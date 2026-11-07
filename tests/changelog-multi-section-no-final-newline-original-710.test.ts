import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";
import {
  malformedHeadings,
  sectionEntries,
  versionBodies,
  versionSections,
} from "./changelog-parser-utils-original-710";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("multi-section fixture parses the same with and without a final newline in every parser", () => {
  const withNewline = read("./__fixtures__/changelog-multi-section.md");
  const without = read("./__fixtures__/changelog-multi-section-no-final-newline.md");
  expect(withNewline.endsWith("\n")).toBe(true);
  expect(without.endsWith("\n")).toBe(false);
  // The pair must be equivalent apart from the trailing newline.
  expect(without).toBe(withNewline.replace(/\n$/, ""));

  expect(parseChangelog(without)).toEqual(parseChangelog(withNewline));
  expect(sectionEntries(without)).toEqual(sectionEntries(withNewline));
  expect(versionSections(without)).toEqual(versionSections(withNewline));
  expect([...versionBodies(without)]).toEqual([...versionBodies(withNewline)]);
  expect(malformedHeadings(without)).toEqual(malformedHeadings(withNewline));
  // The last entry survives without the newline.
  expect(parseChangelog(without).at(-1)?.entries.at(-1)).toBe("Older add.");
});
