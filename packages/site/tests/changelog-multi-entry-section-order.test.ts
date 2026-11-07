import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

type Section = { release: string; heading: string; entries: string[] };

/** Each `###` section under its `##` release, with top-level entry text in parser order. */
function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let release = "";
  let current: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading") {
      if (token.depth <= 2) release = token.text;
      current = token.depth === 3 ? { release, heading: token.text, entries: [] } : null;
      if (current) sections.push(current);
    } else if (token.type === "list" && current) {
      current.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return sections;
}

test("several entries in one section keep source order, including nested lists and blank lines", () => {
  const md = [
    "## 1.0.0",
    "",
    "### Fixed",
    "",
    "- Zulu",
    "  - nested detail",
    "",
    "- Alpha",
    "- Mike",
    "",
  ].join("\n");
  const [section] = parseSections(md);
  expect(section?.entries.map((e) => e.split("\n")[0])).toEqual(["Zulu", "Alpha", "Mike"]);
});

test("same heading name in two releases stays separate and ordered", () => {
  const md = "## 2.0.0\n\n### Fixed\n\n- b2\n- a2\n\n## 1.0.0\n\n### Fixed\n\n- b1\n- a1\n";
  expect(parseSections(md).map((s) => [s.release, s.entries])).toEqual([
    ["2.0.0", ["b2", "a2"]],
    ["1.0.0", ["b1", "a1"]],
  ]);
});

test("published changelog: every multi-entry section lists entries in file order", () => {
  const multi = parseSections(published).filter((s) => s.entries.length >= 2);
  expect(multi.length).toBeGreaterThan(0);
  let sectionStart = 0;
  for (const section of multi) {
    sectionStart = published.indexOf(`### ${section.heading}`, sectionStart);
    expect(sectionStart, `${section.release} / ${section.heading} heading`).toBeGreaterThanOrEqual(0);
    let cursor = sectionStart;
    for (const entry of section.entries) {
      const at = published.indexOf(entry.split("\n")[0].slice(0, 60), cursor);
      expect(at, `${section.release} / ${section.heading}: "${entry.slice(0, 40)}" out of order`).toBeGreaterThanOrEqual(cursor);
      cursor = at;
    }
  }
});
