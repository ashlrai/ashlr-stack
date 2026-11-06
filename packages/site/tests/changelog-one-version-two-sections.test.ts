import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-one-version-two-sections.md"), "utf8");

type Section = { version: string; heading: string; entries: string[] };

/** Each `###` section tagged with its `##` version, with its list entries, in source order. */
function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let version = "";
  let current: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading") {
      if (token.depth <= 2) version = token.depth === 2 ? token.text : "";
      current = token.depth === 3 ? { version, heading: token.text, entries: [] } : null;
      if (current) sections.push(current);
    } else if (token.type === "list" && current) {
      current.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return sections;
}

test("each entry sits under its own section, sections in source order (not alphabetical)", () => {
  expect(parseSections(fixture)).toEqual([
    { version: "0.7.0 (2026-11-02)", heading: "Fixed", entries: ["Fixed entry one.", "Fixed entry two."] },
    { version: "0.7.0 (2026-11-02)", heading: "Added", entries: ["Added entry one."] },
  ]);
});

test("both sections are populated and share the one version", () => {
  const sections = parseSections(fixture);
  expect(sections).toHaveLength(2);
  expect(new Set(sections.map((s) => s.version)).size).toBe(1);
  for (const section of sections) expect(section.entries.length).toBeGreaterThan(0);
});

test("no entry leaks into the other section", () => {
  const [fixed, added] = parseSections(fixture);
  expect(fixed?.entries.some((e) => e.startsWith("Added"))).toBe(false);
  expect(added?.entries.some((e) => e.startsWith("Fixed"))).toBe(false);
});
