import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-link-autolinks.md"), "utf8");

type Link = { type: "link" | "image"; label: string; href: string };

/** Every link and image under a token tree, in document order (descends into list items). */
function collectLinks(tokens: Token[]): Link[] {
  return tokens.flatMap((t): Link[] => {
    if (t.type === "link") return [{ type: "link", label: (t as Tokens.Link).text, href: (t as Tokens.Link).href }];
    if (t.type === "image") return [{ type: "image", label: (t as Tokens.Image).text, href: (t as Tokens.Image).href }];
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

const EXPECTED_060: Link[] = [
  { type: "link", label: "https://stack.ashlr.ai/changelog", href: "https://stack.ashlr.ai/changelog" },
  { type: "link", label: "https://phm.dev/docs", href: "https://phm.dev/docs" },
  { type: "link", label: "setup notes", href: "docs/setup notes.md" },
  // GFM still autolinks the bare URL inside the escaped (non-)link; the escaped label is plain text.
  { type: "link", label: "https://example.com/nope", href: "https://example.com/nope" },
  { type: "image", label: "Stack logo", href: "https://stack.ashlr.ai/logo.png" },
  { type: "link", label: "the guide", href: "docs/guide.md" },
];

test("autolinks, angle destinations, images and nested links keep label and destination", () => {
  expect(linksFor(fixture, "0.6.0 (2026-11-03)")).toEqual(EXPECTED_060);
});

test("escaped brackets are not parsed as a [label](destination) link", () => {
  const links = linksFor(fixture, "0.6.0 (2026-11-03)");
  expect(links.some((l) => l.label === "not a link")).toBe(false);
});

test("a mailto destination is kept as written", () => {
  expect(linksFor(fixture, "0.5.0 (2026-11-02)")).toEqual([
    { type: "link", label: "support", href: "mailto:support@ashlr.ai" },
  ]);
});

test("links parse the same from a CRLF copy of the fixture", () => {
  const crlf = fixture.replace(/\r?\n/g, "\r\n");
  expect(linksFor(crlf, "0.6.0 (2026-11-03)")).toEqual(EXPECTED_060);
  expect(JSON.stringify(linksFor(crlf, "0.5.0 (2026-11-02)"))).not.toContain("\\r");
});
