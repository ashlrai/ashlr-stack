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
