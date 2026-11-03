import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-linked-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

type Link = { text: string; href: string };

/** Links found anywhere inside one token tree, in source order. */
function links(tokens: Token[]): Link[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "link" ? [{ text: t.text, href: t.href }] : []), ...links(children)];
  });
}

/** Each list entry under the `##` heading with this exact text: its source text and links. */
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

test("a parsed entry keeps its text and link destination", () => {
  const parsed = entries(fixture, "0.2.0 (2026-05-01)");
  expect(parsed.map((e) => e.links)).toEqual([
    [{ text: "adding a provider guide", href: "docs/adding-a-provider.md" }],
    [
      { text: "phm.dev", href: "https://phm.dev" },
      { text: "the vault docs", href: "https://phm.dev/docs?a=1&b=2#vault" },
      { text: "local notes", href: "docs/my notes.md" },
    ],
    [],
  ]);
  expect(parsed[0].text).toBe("Read the [adding a provider guide](docs/adding-a-provider.md) before wiring one.");
  expect(parsed[2].text).toBe("Fixed a crash (#12) with no link.");
});

test("rendered HTML keeps the link text and destination", async () => {
  const html = await marked.parse("- Read the [guide](docs/adding-a-provider.md) first.");
  expect(html).toContain('<a href="docs/adding-a-provider.md">guide</a>');
});

test("links do not leak into the neighbouring version's entries", () => {
  expect(entries(fixture, "0.1.0 (2026-04-19)").map((e) => e.links)).toEqual([
    [{ text: "release notes", href: "https://example.com/0.1.0" }],
  ]);
});

test("every published link keeps its text and destination inside its own entry", () => {
  const parsed = entries(published, "Unreleased").concat(entries(published, "0.3.0 (2026-10-31)"));
  for (const entry of parsed) {
    for (const l of entry.links) {
      expect(l.href).not.toBe("");
      expect(entry.text).toContain(`](${l.href}`);
    }
  }
});
