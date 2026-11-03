import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries } from "./changelog-parser-utils";

/** Reduces an entry to its `,` `(` `)` `:` characters, in source order. */
const punctuation = (entry: string) => entry.replace(/[^,():]/g, "");

const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const fixture = readFileSync(new URL("./__fixtures__/changelog-punctuation.md", import.meta.url), "utf8");

test("CHANGELOG.md entry keeps commas, parentheses and a colon in order", () => {
  const unreleased = sectionEntries(source).find((g) => g.version === "## Unreleased" && g.section === "Fixed");
  const entry = unreleased?.entries.find((e) => e.startsWith("Fleet JSONL reads"));
  expect(entry).toBeDefined();
  expect(entry).toContain("reads (`stack fleet` diagnostics) now enforce the byte cap while reading: a non-tail read grows one buffer up to the cap, probes");
  expect(entry).toEndWith("whole file first (#360).");
  // Parenthetical, colon, two commas, two more parentheticals — nothing dropped or reordered.
  expect(punctuation(entry as string)).toBe("():,,()()");
});

test("fixture entry keeps commas, parentheses and a colon in order", () => {
  const fixed = sectionEntries(fixture).find((g) => g.version.includes("0.3.0") && g.section === "Fixed");
  expect(fixed?.entries[0]).toBe("Fixed timeout handling: connections now close cleanly (fixes #456, closes #457).");
  expect(punctuation(fixed?.entries[0] as string)).toBe(":(,)");
  expect(punctuation(fixed?.entries[1] as string)).toBe(":,(:)()");
});
