import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-link-wrapped.md"), "utf8");

type Link = { text: string; href: string };

/** Links found anywhere inside one token tree, in source order. */
function links(tokens: Token[]): Link[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "link" ? [{ text: t.text, href: t.href }] : []), ...children.length ? links(children) : []];
  });
}

const items = marked
  .lexer(fixture)
  .filter((t): t is Tokens.List => t.type === "list")
  .flatMap((list) => list.items);

test("a link whose label wraps across lines keeps its text and destination", () => {
  expect(links(items[0].tokens)).toEqual([
    { text: "provider\nguide", href: "docs/adding-a-provider.md" },
    { text: "Neon", href: "https://neon.tech" },
  ]);
});

test("a link in a later paragraph of an entry stays with that entry", () => {
  expect(links(items[1].tokens)).toEqual([{ text: "vault docs", href: "https://phm.dev/docs#vault" }]);
  expect(items[1].text).toContain("[vault docs](https://phm.dev/docs#vault)");
});

test("a link on a continuation line belongs to its own entry", () => {
  expect(links(items[2].tokens)).toEqual([{ text: "the setup page", href: "docs/setup.md" }]);
  expect(items).toHaveLength(3);
});

test("rendered HTML keeps the wrapped link's destination", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain('<a href="docs/adding-a-provider.md">provider\nguide</a>');
  expect(html).toContain('<a href="docs/setup.md">the setup page</a>');
});
