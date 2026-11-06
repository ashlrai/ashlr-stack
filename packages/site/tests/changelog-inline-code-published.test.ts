import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-published.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Code span text inside one token tree, in source order. */
function spans(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "codespan" ? [t.text] : []), ...spans(children)];
  });
}

/** Every list item in the document, with its code spans. */
function entries(markdown: string): { text: string; code: string[] }[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => ({ text: item.text, code: spans(item.tokens) })));
}

test("dollar placeholders, globs, flags and paths survive as exact code text", () => {
  expect(entries(fixture).map((e) => e.code)).toEqual([
    ["$VERSION$", "$SHA_*$", "sed"],
    ["scripts/mcp-registry-gate.mjs", "--noWire"],
    ["stack fleet"],
  ]);
});

test("the inline code in the fixture matches the entries it was copied from", () => {
  const publishedCode = new Set(entries(published).flatMap((e) => e.code));
  for (const code of entries(fixture).flatMap((e) => e.code)) expect(publishedCode.has(code)).toBe(true);
});
