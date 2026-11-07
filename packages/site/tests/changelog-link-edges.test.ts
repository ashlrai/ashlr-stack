import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-link-edges.md"), "utf8");

type Link = { label: string; href: string; title: string | null };

/** Every inline link under a token tree, in document order (descends into list items). */
function collectLinks(tokens: Token[]): Link[] {
  return tokens.flatMap((t): Link[] => {
    if (t.type === "link") {
      const l = t as Tokens.Link;
      return [{ label: l.text, href: l.href, title: l.title ?? null }];
    }
    if (t.type === "list") return (t as Tokens.List).items.flatMap((item) => collectLinks(item.tokens));
    return "tokens" in t && Array.isArray(t.tokens) ? collectLinks(t.tokens) : [];
  });
}

/** Links in the body of the `##` section whose heading text is exactly `heading`. */
function linksFor(heading: string): Link[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return collectLinks(tokens.slice(start + 1, end === -1 ? undefined : end));
}

test("link edge cases keep label, destination and title", () => {
  expect(linksFor("0.5.0 (2026-11-02)")).toEqual([
    { label: "stack docs", href: "https://stack.ashlr.ai/docs", title: "Stack documentation" },
    { label: "Result type", href: "https://en.wikipedia.org/wiki/Result_(programming)", title: null },
    { label: "`stack add`", href: "https://stack.ashlr.ai/docs/add", title: null },
    { label: "**bold** guide", href: "docs/guide.md", title: null },
    { label: "pricing", href: "https://stack.ashlr.ai/pricing?plan=pro&seat=2#compare", title: null },
    {
      label: "release notes",
      href: "https://github.com/ashlrai/ashlr-stack/releases",
      title: "All releases",
    },
    { label: "shortcut", href: "docs/shortcut.md", title: null },
    { label: "Neon", href: "https://neon.tech", title: null },
  ]);
});

test("a version without links reports none", () => {
  expect(linksFor("0.4.0 (2026-11-01)")).toEqual([]);
});

test("rendered HTML keeps the title and the full query destination", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain('<a href="https://stack.ashlr.ai/docs" title="Stack documentation">stack docs</a>');
  expect(html).toContain("pricing?plan=pro&seat=2#compare");
});
