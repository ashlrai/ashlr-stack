import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(
  join(import.meta.dir, "__fixtures__/changelog-unreleased-entries-empty-version.md"),
  "utf8",
);

type Section = { heading: string; entries: string[] };

/** Every `##` section in source order (Unreleased included) with its list items. */
function parse(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 ? { heading: token.text, entries: [] } : null;
      if (current) sections.push(current);
    } else if (token.type === "list" && current) {
      for (const item of token.items) current.entries.push(item.text);
    }
  }
  return sections;
}

test("a version heading without entries is preserved and returns no entries", () => {
  const empty = parse(fixture).find((s) => s.heading === "[0.3.0] - 2026-04-25");
  expect(empty).toEqual({ heading: "[0.3.0] - 2026-04-25", entries: [] });
});

test("entries above and below the empty version stay with their own headings", () => {
  expect(parse(fixture)).toEqual([
    {
      heading: "Unreleased",
      entries: ["Pending entry belongs to Unreleased, not to the empty release below."],
    },
    { heading: "[0.3.0] - 2026-04-25", entries: [] },
    { heading: "0.2.0 (2026-04-23)", entries: ["Older entry stays under 0.2.0."] },
  ]);
});

test("the empty version still renders as a heading with no list after it", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<h2>[0.3.0] - 2026-04-25</h2>");
  const afterEmpty = html.split("<h2>[0.3.0] - 2026-04-25</h2>")[1].split("<h2>")[0];
  expect(afterEmpty.trim()).toBe("");
});
