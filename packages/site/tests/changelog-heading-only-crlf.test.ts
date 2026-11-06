import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-heading-only-crlf.md"), "utf8");

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order with the list items in their sections. */
function parse(markdown: string): { heading: string; items: string[] }[] {
  const out: { heading: string; items: string[] }[] = [];
  let current: (typeof out)[number] | null = null;
  for (const t of marked.lexer(markdown) as Token[]) {
    if (t.type === "heading" && (t as Tokens.Heading).depth <= 2) {
      const text = (t as Tokens.Heading).text;
      current = (t as Tokens.Heading).depth === 2 && VERSION.test(text) ? { heading: text, items: [] } : null;
      if (current) out.push(current);
    } else if (current && t.type === "list") {
      current.items.push(...(t as Tokens.List).items.map((i) => i.text));
    }
  }
  return out;
}

test("CRLF fixture is really CRLF", () => {
  expect(fixture).toContain("\r\n");
});

test("a heading-only version in a CRLF changelog keeps its exact version and has no entries", () => {
  const versions = parse(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["0.2.0 (2026-04-23)", "0.1.0 (2026-04-19)"]);
  expect(versions[0].items).toEqual([]);
  expect(versions[1].items).toEqual(["first"]);
});
