import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// The fleet JSONL entry excerpted from packages/site/src/data/CHANGELOG.md, Unreleased / Fixed.
// It has three parenthesized spans: one around inline code, one with a plain-text "or", and a trailing (#360).
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-parentheses-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

const PARENTHESIZED = ["(`stack fleet` diagnostics)", "(negative or non-integer)", "(#360)"];

function entries(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("the parsed entry keeps every parenthesized span and the punctuation around it", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(1);
  for (const span of PARENTHESIZED) expect(found[0].text).toContain(span);
  expect(found[0].text).toStartWith("Fleet JSONL reads (`stack fleet` diagnostics) now enforce");
  expect(found[0].text).toContain("the byte cap while reading: a non-tail read");
  expect(found[0].text).toEndWith("reading the whole file first (#360).");
});

test("parentheses do not turn the entry into a link, heading or second item", () => {
  const tokens = marked.lexer(fixture);
  expect(tokens.filter((t) => t.type === "heading").map((t) => (t as Tokens.Heading).text)).toEqual([
    "Changelog",
    "Unreleased",
    "Fixed",
  ]);
  expect(entries(fixture)).toHaveLength(1);
  const inline = (entries(fixture)[0].tokens[0] as Tokens.Text).tokens ?? [];
  expect(inline.some((t) => t.type === "link")).toBe(false);
});

test("the rendered entry keeps the parentheses, the inline code and the trailing period", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<li>Fleet JSONL reads (<code>stack fleet</code> diagnostics) now enforce");
  expect(html).toContain("an invalid cap (negative or non-integer) instead of");
  expect(html).toContain("reading the whole file first (#360).</li>");
});

test("the fixture entry is still present verbatim in the published changelog", () => {
  expect(entries(published).map((e) => e.raw.trim())).toContain(entries(fixture)[0].raw.trim());
});
