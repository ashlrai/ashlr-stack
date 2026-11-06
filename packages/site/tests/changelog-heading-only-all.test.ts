import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-heading-only-all.md"), "utf8");

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions with the list items found anywhere in their sections (subsections included). */
function parse(markdown: string): { heading: string; subsections: string[]; items: number }[] {
  const out: { heading: string; subsections: string[]; items: number }[] = [];
  let current: (typeof out)[number] | null = null;
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && (t as Tokens.Heading).depth <= 2) {
      current = (t as Tokens.Heading).depth === 2 && VERSION.test((t as Tokens.Heading).text)
        ? { heading: (t as Tokens.Heading).text, subsections: [], items: 0 }
        : null;
      if (current) out.push(current);
    } else if (current && t.type === "heading") current.subsections.push((t as Tokens.Heading).text);
    else if (current && t.type === "list") current.items += (t as Tokens.List).items.length;
  }
  return out;
}

test("a changelog of only headings returns every released version with no entries", () => {
  const versions = parse(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["0.2.0 (2026-04-23)", "0.1.0 (2026-04-19)"]);
  expect(versions.map((v) => v.items)).toEqual([0, 0]);
});

test("empty subsections are kept as headings and fabricate no entries", () => {
  const [newest, oldest] = parse(fixture);
  expect(newest.subsections).toEqual(["Added", "Fixed"]);
  expect(oldest.subsections).toEqual([]);
});

test("rendered HTML has the headings and no list items", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<h2>0.1.0 (2026-04-19)</h2>");
  expect(html).not.toContain("<li");
  expect(marked.lexer(fixture).some((t: Token) => t.type === "list")).toBe(false);
});
