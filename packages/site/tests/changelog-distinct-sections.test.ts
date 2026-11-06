import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

/** List item text keyed by `version / section`, in source order. */
function entriesBySection(markdown: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let key = "";
  let h2 = "";
  for (const token of marked.lexer(markdown) as Token[]) {
    if (token.type === "heading" && token.depth >= 2) {
      if (token.depth === 2) h2 = token.text;
      key = token.depth === 2 ? h2 : `${h2} / ${token.text}`;
      sections[key] = [];
    } else if (token.type === "list" && key) {
      sections[key].push(...token.items.map((i: { text: string }) => i.text.trim()));
    }
  }
  return sections;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-distinct-sections.md"), "utf8");

test("each entry stays under its own section, including repeated headings across versions", () => {
  expect(entriesBySection(fixture)).toEqual({
    Unreleased: [],
    "Unreleased / Security": ["Pin action SHAs."],
    "0.4.0 (2026-06-01)": [],
    "0.4.0 (2026-06-01) / Added": ["Add one.", "Add two."],
    "0.4.0 (2026-06-01) / Changed": ["Change one."],
    "0.4.0 (2026-06-01) / Deprecated": ["Deprecate one."],
    "0.4.0 (2026-06-01) / Removed": ["Remove one."],
    "0.4.0 (2026-06-01) / Fixed": ["Fix one.", "Fix two."],
    "0.4.0 (2026-06-01) / Security": ["Security one."],
    "0.3.0 (2026-05-01)": [],
    "0.3.0 (2026-05-01) / Fixed": ["Older fix."],
    "0.3.0 (2026-05-01) / Added": ["Older add."],
  });
});

test("section order does not change which entries belong to a section", () => {
  const sections = entriesBySection(fixture);
  expect(sections["0.3.0 (2026-05-01) / Fixed"]).not.toContain("Older add.");
  expect(sections["0.4.0 (2026-06-01) / Fixed"]).not.toContain("Older fix.");
});
