import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const root = join(import.meta.dir, "../../..");
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-one-entry-one-section.md"), "utf8");

type Section = { heading: string; entries: string[] };

/** Each `###` section with its list entries, in source order. */
function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading") {
      current = token.depth === 3 ? { heading: token.text, entries: [] } : null;
      if (current) sections.push(current);
    } else if (token.type === "list" && current) {
      current.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return sections;
}

test("parser returns the single section and its entry once", () => {
  expect(parseSections(fixture)).toEqual([
    { heading: "Added", entries: ["Single entry in the only section."] },
  ]);
});

test("the entry is counted exactly once with no duplicates", () => {
  const [section] = parseSections(fixture);
  expect(section).not.toBeNull();
  expect(section!.entries).toHaveLength(1);
  expect(section!.entries.filter((e) => e === section!.entries[0])).toHaveLength(1);
});

test("published changelog section entries are unique within their sections", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const sections = parseSections(published);
  expect(sections.length).toBeGreaterThan(0);
  for (const section of sections) {
    for (const entry of section.entries) {
      expect(section.entries.filter((e) => e === entry), `duplicate in ${section.heading}`).toHaveLength(1);
    }
  }
});
