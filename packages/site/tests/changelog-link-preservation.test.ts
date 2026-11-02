import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-link-preservation.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

type Link = { label: string; href: string };

/** Every link inside the list entries under the `##` heading with this exact text, in document order. */
function linksFor(markdown: string, version: string): Link[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  const links: Link[] = [];
  marked.walkTokens(tokens.slice(start + 1, end === -1 ? undefined : end), (token) => {
    if (token.type === "link") links.push({ label: token.text, href: (token as Tokens.Link).href });
  });
  return links;
}

test("a version entry keeps each link label and destination", () => {
  expect(linksFor(fixture, "0.4.0 (2026-11-01)")).toEqual([
    { label: "Cloudflare Workers", href: "https://workers.dev" },
    { label: "Durable Objects", href: "https://developers.cloudflare.com/durable-objects" },
    { label: "adding a provider guide", href: "docs/adding-a-provider.md" },
    { label: "Phantom", href: "https://phm.dev" },
  ]);
});

test("a bracketed version heading keeps the links in its entries", () => {
  expect(linksFor(fixture, "[0.3.0] — 2026-06-15")).toEqual([
    { label: "stack add", href: "https://stack.ashlr.ai/docs/add" },
    { label: "GitHub repository", href: "https://github.com/ashlrai/ashlr-stack" },
  ]);
});

test("links do not leak into a section without any", () => {
  expect(linksFor(fixture, "Unreleased")).toEqual([]);
});

test("rendered entries keep the label as anchor text and the destination as href", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain('<a href="https://workers.dev">Cloudflare Workers</a>');
  expect(html).toContain('<a href="docs/adding-a-provider.md">adding a provider guide</a>');
  expect(html).toContain('<a href="https://github.com/ashlrai/ashlr-stack">GitHub repository</a>');
});

test("the published changelog's 0.1.0 apply entry keeps its Phantom link", () => {
  expect(linksFor(published, "0.1.0 — 2026-04-19 (superseded by 0.1.1)")).toContainEqual({
    label: "Phantom",
    href: "https://phm.dev",
  });
});
