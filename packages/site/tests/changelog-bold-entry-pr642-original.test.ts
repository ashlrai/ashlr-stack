import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-bold-entry-pr642-original.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Bold (`strong`) text found anywhere inside one token tree, in source order. */
function bolds(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "strong" ? [t.text] : []), ...bolds(children)];
  });
}

/** Each list entry under the `##` heading with this exact text: its source text and bold spans. */
function entries(markdown: string, version: string): { text: string; bold: string[] }[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => ({ text: item.text, bold: bolds(item.tokens) })));
}

test("a bold entry stays under its version and keeps its text", () => {
  const parsed = entries(fixture, "0.2.0 (2026-05-01)");
  expect(parsed.map((e) => e.bold)).toEqual([
    ["Bold lead:"],
    ["bold middle"],
    ["Underscore bold", "bold with `code` inside"],
    ["Whole entry is bold."],
    [],
  ]);
  expect(parsed[0].text).toBe("**Bold lead:** the rest of the entry follows in plain text.");
  expect(parsed[3].text).toBe("**Whole entry is bold.**");
});

test("bold text does not leak into the neighbouring version", () => {
  const parsed = entries(fixture, "0.1.0 (2026-04-19)");
  expect(parsed.map((e) => e.bold)).toEqual([["First release"]]);
  expect(parsed[0].text).toBe("**First release** shipped.");
});

test("every published Unreleased entry keeps each bold span inside its own text", () => {
  const parsed = entries(published, "Unreleased");
  expect(parsed.length).toBeGreaterThan(0);
  for (const entry of parsed) {
    for (const bold of entry.bold) expect(entry.text).toContain(bold);
  }
});
