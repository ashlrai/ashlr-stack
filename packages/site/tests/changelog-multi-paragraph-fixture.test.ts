import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-multi-paragraph.md"), "utf8");

/** Paragraph texts of every list item under the `##` heading with this exact text, one array per item. */
function paragraphsFor(markdown: string, version: string): string[][] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) =>
      list.items.map((item) => item.tokens.filter((t) => t.type === "text" || t.type === "paragraph").map((t) => (t as Tokens.Paragraph).text)),
    );
}

test("both paragraphs of an entry stay in one list item under the same version", () => {
  expect(paragraphsFor(fixture, "0.2.0 (2026-02-01)")).toEqual([
    ["First paragraph of the entry.", "Second paragraph of the same entry, with `code` in it."],
    ["Single-paragraph entry"],
  ]);
});

test("the second paragraph does not leak into the neighbouring version", () => {
  expect(paragraphsFor(fixture, "0.1.0 (2026-01-01)")).toEqual([
    ["Older entry, first paragraph.", "Older entry, second paragraph."],
  ]);
});

test("the second paragraph is never read as a top-level block", () => {
  const topLevel = marked.lexer(fixture).filter((t) => t.type === "paragraph");
  expect(topLevel).toHaveLength(0);
});
