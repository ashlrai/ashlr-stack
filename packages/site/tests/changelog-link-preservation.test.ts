import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-link-preservation.md"), "utf8");

type Link = { label: string; href: string };

/** Every inline link under a token tree, in document order (descends into list items). */
function collectLinks(tokens: Token[]): Link[] {
  return tokens.flatMap((t): Link[] => {
    if (t.type === "link") return [{ label: (t as Tokens.Link).text, href: (t as Tokens.Link).href }];
    if (t.type === "list") return (t as Tokens.List).items.flatMap((item) => collectLinks(item.tokens));
    return "tokens" in t && Array.isArray(t.tokens) ? collectLinks(t.tokens) : [];
  });
}

/** Links in the body of the `##` section whose heading text is exactly `heading`. */
function linksFor(markdown: string, heading: string): Link[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return collectLinks(tokens.slice(start + 1, end === -1 ? undefined : end));
}

test("a version entry keeps each link's label and destination, in order", () => {
  expect(linksFor(fixture, "0.4.0 (2026-11-01)")).toEqual([
    { label: "Cloudflare Workers", href: "https://workers.dev" },
    { label: "Durable Objects", href: "https://developers.cloudflare.com/durable-objects" },
    { label: "adding a provider guide", href: "docs/adding-a-provider.md" },
    { label: "Phantom", href: "https://phm.dev" },
  ]);
});

test("links under a bracketed version heading stay with that version", () => {
  expect(linksFor(fixture, "[0.3.0] — 2026-06-15")).toEqual([
    { label: "stack add", href: "https://stack.ashlr.ai/docs/add" },
    { label: "GitHub repository", href: "https://github.com/ashlrai/ashlr-stack" },
  ]);
});

test("a section without links reports none and the links do not leak into it", () => {
  expect(linksFor(fixture, "Unreleased")).toEqual([]);
});

test("the raw entry text still contains each [label](destination) pair", () => {
  const raw = marked.lexer(fixture).map((t) => t.raw).join("");
  for (const pair of [
    "[Cloudflare Workers](https://workers.dev)",
    "[adding a provider guide](docs/adding-a-provider.md)",
    "[stack add](https://stack.ashlr.ai/docs/add)",
  ]) {
    expect(raw).toContain(pair);
  }
});

test("rendered HTML keeps each link's label and href", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain('<a href="https://phm.dev">Phantom</a>');
  expect(html).toContain('<a href="docs/adding-a-provider.md">adding a provider guide</a>');
});

test("the published changelog keeps the Phantom link on the apply entry", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const tokens = marked.lexer(published);
  const entry = tokens
    .flatMap((t) => (t.type === "list" ? (t as Tokens.List).items : []))
    .find((item) => item.raw.startsWith("- **`stack apply [recipe-id]`**"));
  expect(entry).toBeDefined();
  expect(collectLinks(entry?.tokens ?? [])).toContainEqual({ label: "Phantom", href: "https://phm.dev" });
});
