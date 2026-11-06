import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-two-entries-one-section.md"), "utf8");

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

test("both entries appear once, in source order, under the one section", () => {
  expect(parseSections(fixture)).toEqual([
    { heading: "Added", entries: ["First entry in the section.", "Second entry in the section."] },
  ]);
});

test("each entry is counted exactly once", () => {
  const [section] = parseSections(fixture);
  for (const entry of section?.entries ?? []) {
    expect(section?.entries.filter((e) => e === entry)).toHaveLength(1);
  }
});

test("the real site changelog keeps a multi-entry section in source order", () => {
  const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const [version] = real.split(/^## /m).slice(1, 2);
  const changed = parseSections(`## ${version}`).find((s) => s.heading === "Fixed");
  expect(changed?.entries.length).toBeGreaterThanOrEqual(2);
  const lines = real.split("\n").filter((l) => l.startsWith("- "));
  const positions = (changed?.entries ?? []).map((e) => lines.findIndex((l) => l.slice(2).startsWith(e.slice(0, 40))));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
});
