import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

/** Raw markdown of every list item under each `##`/`###` heading, in source order. */
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

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-bold-entry.md"), "utf8");

test("bold entries stay under their version and keep their text", () => {
  expect(entriesBySection(fixture)).toEqual({
    Unreleased: [],
    "0.3.0 (2026-05-01)": [],
    "0.3.0 (2026-05-01) / Added": [
      "**Bold lead-in:** the rest of the entry.",
      "**Entirely bold entry.**",
      "Plain entry with a **bold** word inside.",
    ],
    "0.3.0 (2026-05-01) / Fixed": ["Plain fix."],
    "0.2.0 (2026-04-23)": ["**Older bold entry** kept under its own version."],
  });
});

test("bold entries render as <strong> without leaking into headings", () => {
  const html = marked.parse(fixture) as string;
  expect(html).toContain("<strong>Bold lead-in:</strong> the rest of the entry.");
  expect(html).toContain("<li><strong>Entirely bold entry.</strong></li>");
  expect(html).not.toMatch(/<h[1-6]>[^<]*<strong>/);
});
