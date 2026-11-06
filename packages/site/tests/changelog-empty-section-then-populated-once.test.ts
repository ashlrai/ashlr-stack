import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

type Entry = { release: string; section: string; text: string };

/** Flat list of every list entry with the `##` release and `###` section it sits under. */
function entries(markdown: string): Entry[] {
  const found: Entry[] = [];
  let release = "";
  let section: string | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      release = token.depth === 2 ? token.text : "";
      section = null;
    } else if (token.type === "heading" && token.depth === 3) {
      section = token.text;
    } else if (token.type === "list" && section) {
      for (const item of token.items) found.push({ release, section, text: item.text });
    }
  }
  return found;
}

const fixture = readFileSync(
  join(import.meta.dir, "__fixtures__/changelog-empty-section-then-populated-once.md"),
  "utf8",
);

test("the populated entry is attached to its own section and returned once", () => {
  const found = entries(fixture);
  expect(found.filter((e) => e.text.startsWith("Populated entry"))).toEqual([
    {
      release: "Unreleased",
      section: "Fixed",
      text: "Populated entry belongs to Fixed and is returned once.",
    },
  ]);
});

test("the empty section before it contributes nothing, and no entry is duplicated", () => {
  const found = entries(fixture);
  expect(found.filter((e) => e.release === "Unreleased" && e.section === "Changed")).toEqual([]);
  expect(found).toHaveLength(2);
  expect(new Set(found.map((e) => e.text)).size).toBe(found.length);
});

test("a same-named section in the next release keeps its own entry", () => {
  expect(entries(fixture).filter((e) => e.section === "Changed")).toEqual([
    {
      release: "0.2.0 (2026-04-23)",
      section: "Changed",
      text: "Same-named Changed section in an older release keeps its own entry.",
    },
  ]);
});
