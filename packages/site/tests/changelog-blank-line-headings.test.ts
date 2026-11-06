import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

/** Every top-level bullet's text under each `##`/`###` heading, in source order. */
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

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-blank-line-headings.md"), "utf8");

test("blank lines around headings, at file edges and with whitespace-only lines create no extra entries", () => {
  expect(entriesBySection(fixture)).toEqual({
    "0.4.0 (2026-05-10)": [],
    "0.4.0 (2026-05-10) / Added": ["Wrapped entry that\ncontinues on a second line.", "Next entry."],
    "0.4.0 (2026-05-10) / Fixed": ["Only fix."],
    "[0.3.0] — 2026-05-01": ["Old entry."],
  });
});

test("entry count equals the number of bullet markers in the source", () => {
  const entries = Object.values(entriesBySection(fixture)).flat();
  expect(entries).toHaveLength(fixture.split("\n").filter((l) => /^- /.test(l)).length);
});

test("the real CHANGELOG.md parses identically with blank lines widened before headings and bullets", () => {
  const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const expected = entriesBySection(real);
  expect(Object.values(expected).flat().length).toBeGreaterThan(1);
  const widened = `\n\n${real.replace(/\n\n(?=#{2,3} |- )/g, "\n \n\t\n\n\n")}\n\n\n`;
  expect(entriesBySection(widened)).toEqual(expected);
});
