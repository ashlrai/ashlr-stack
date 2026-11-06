import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Every inline link under a token tree, in document order (descends into list items). */
function collectLinks(tokens: Token[]): Tokens.Link[] {
  return tokens.flatMap((t): Tokens.Link[] => {
    if (t.type === "link") return [t as Tokens.Link];
    if (t.type === "list") return (t as Tokens.List).items.flatMap((item) => collectLinks(item.tokens));
    return "tokens" in t && Array.isArray(t.tokens) ? collectLinks(t.tokens) : [];
  });
}

test("every link in the published changelog keeps a label and a destination", () => {
  const links = collectLinks(marked.lexer(published));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.text.trim()).not.toBe("");
    expect(link.href.trim()).not.toBe("");
  }
});

test("each parsed link's [label](destination) text appears verbatim in the source", () => {
  for (const link of collectLinks(marked.lexer(published))) {
    // Reference-style links have no inline destination; only check inline ones.
    if (/^\[[^\]]*\]\(/.test(link.raw)) expect(published).toContain(link.raw);
  }
});
