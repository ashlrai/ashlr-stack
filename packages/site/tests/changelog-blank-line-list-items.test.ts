import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

/** Every list item's text under each `##`/`###` heading, in source order. */
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

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-blank-line-list-items.md"), "utf8");

test("blank lines between bullets do not add or drop entries", () => {
  expect(entriesBySection(fixture)).toEqual({
    Unreleased: [],
    "0.3.0 (2026-05-01)": [],
    "0.3.0 (2026-05-01) / Added": ["Alpha.", "Beta.", "Gamma.", "Delta."],
    "0.3.0 (2026-05-01) / Fixed": ["Epsilon.", "Zeta."],
    "0.2.0 (2026-04-23)": ["Eta."],
  });
});

test("stripping every blank line between bullets yields the same entries", () => {
  const tight = fixture.replace(/\n[ \t]*\n(?=- )/g, "\n").replace(/\n(?:[ \t]*\n)+(?=- )/g, "\n");
  expect(entriesBySection(tight)).toEqual(entriesBySection(fixture));
});

test("extra blank lines never create an empty entry", () => {
  for (const items of Object.values(entriesBySection(fixture.replace(/\n\n/g, "\n\n\n\n")))) {
    for (const item of items) expect(item.length).toBeGreaterThan(0);
  }
});
