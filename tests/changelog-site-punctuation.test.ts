import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries } from "./changelog-parser-utils";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Only the commas, parentheses and colons of an entry, in source order. */
const punctuation = (entry: string) => entry.replace(/[^,():]/g, "");

test("fixture entry keeps commas, parentheses and a colon in order", () => {
  const [group] = sectionEntries(read("./__fixtures__/changelog-punctuation-order.md"));
  expect(group.entries).toEqual([
    "Reads (large, growing files) now stop at the cap: a probe byte, not a full read, detects overflow (#1, #2).",
  ]);
  expect(punctuation(group.entries[0])).toBe("(,):,,(,)");
});

test("site CHANGELOG.md entry keeps its punctuation in order", () => {
  const md = read("../packages/site/src/data/CHANGELOG.md");
  const fixed = sectionEntries(md).find((g) => g.version === "## Unreleased" && g.section === "Fixed");
  const entry = fixed?.entries.find((e) => e.startsWith("Fleet JSONL reads (`stack fleet` diagnostics)"));
  expect(entry).toBeDefined();
  // Parenthetical, colon, two commas, then the two closing parentheticals.
  expect(punctuation(entry as string)).toBe("():,,()()");
  expect(entry).toContain("(negative or non-integer)");
  expect(entry?.endsWith("(#360).")).toBe(true);
});

/** Every punctuation mark the parser must pass through untouched. */
const MARKS = /[;"'—…?!\[\]{}|*&~/`-]/g;

test("fixture entry keeps semicolons, quotes, dashes, ellipsis, brackets and trailing marks verbatim", () => {
  const [group] = sectionEntries(read("./__fixtures__/changelog-punctuation-marks.md"));
  expect(group.entries).toEqual([
    "Apply skips \"placeholder\" secrets; it's now strict — no stubs, no guesses… really? Yes! Use `--noWire` [optional] or {braces} - see a/b, c|d, e*f & g~h.",
    "Trailing marks stay: end with a question?",
  ]);
  expect(group.entries[1].endsWith("?")).toBe(true);
});

test("site CHANGELOG.md Changed entry keeps its semicolons and backticks", () => {
  const md = read("../packages/site/src/data/CHANGELOG.md");
  const changed = sectionEntries(md).find((g) => g.version === "## Unreleased" && g.section === "Changed");
  const entry = changed?.entries.find((e) => e.startsWith("`stack apply` does not create placeholder secrets."));
  expect(entry).toBeDefined();
  expect(entry).toContain("; a missing name does not itself fail apply, while provider failures do.");
  expect(entry?.endsWith("`--noWire` skips both checks and stubs.")).toBe(true);
  expect((entry as string).match(MARKS)?.join("")).toContain(";");
});
