import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-self-link.md"), "utf8");

type Link = { text: string; href: string };

/** Links found anywhere inside one token tree, in source order. */
function links(tokens: Token[]): Link[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "link" ? [{ text: t.text, href: t.href }] : []), ...links(children)];
  });
}

/** List entries under the `##` heading with this exact text: source text and links. */
function entries(markdown: string, version: string): { text: string; links: Link[] }[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => ({ text: item.text, links: links(item.tokens) })));
}

const VERSION = "0.4.0 (2026-11-03)";

test("an entry linking to CHANGELOG.md keeps its link text and destination", () => {
  const parsed = entries(fixture, VERSION);
  expect(parsed).toHaveLength(3);
  expect(parsed[0].links).toEqual([{ text: "full changelog", href: "CHANGELOG.md" }]);
  expect(parsed[0].text).toBe("Moved the old notes; see the [full changelog](CHANGELOG.md) for history.");
});

test("nested-path, fragment and ./ CHANGELOG.md destinations stay as written", () => {
  expect(entries(fixture, VERSION)[1].links).toEqual([
    { text: "site changelog", href: "packages/site/src/data/CHANGELOG.md#unreleased" },
    { text: "root", href: "./CHANGELOG.md" },
  ]);
});

test("a link-free entry beside link entries has no links", () => {
  expect(entries(fixture, VERSION)[2].links).toEqual([]);
});

test("rendered HTML keeps the CHANGELOG.md link text and destination", async () => {
  const html = await marked.parse("- See the [full changelog](CHANGELOG.md).");
  expect(html).toContain('<a href="CHANGELOG.md">full changelog</a>');
});
