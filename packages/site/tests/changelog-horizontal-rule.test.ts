import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-horizontal-rule.md"), "utf8");
const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order: heading text and the tokens up to the next `##` heading. */
function parseVersions(markdown: string): { heading: string; body: Token[] }[] {
  const versions: { heading: string; body: Token[] }[] = [];
  let current: { heading: string; body: Token[] } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, body: [] } : null;
      if (current) versions.push(current);
    } else current?.body.push(token);
  }
  return versions;
}

const listItems = (body: Token[]) =>
  body.flatMap((t) => (t.type === "list" ? t.items.map((i: { text: string }) => i.text) : []));

test("the fixture uses all three rule styles between and after version sections", () => {
  expect(marked.lexer(fixture).filter((t) => t.type === "hr")).toHaveLength(3);
});

test("a rule between version sections does not create an extra version", () => {
  expect(parseVersions(fixture).map((v) => v.heading)).toEqual([
    "0.3.0 (2026-05-01)",
    "[0.2.0] — 2026-04-23",
    "0.1.0 (2026-04-19)",
  ]);
});

test("a rule does not merge entries across versions or turn into a heading or entry", () => {
  const versions = parseVersions(fixture);
  expect(versions.map((v) => listItems(v.body))).toEqual([
    ["Third version entry."],
    ["Second version entry."],
    ["First version entry."],
  ]);
  const tokens = marked.lexer(fixture);
  expect(tokens.filter((t) => t.type === "heading" && t.depth === 2)).toHaveLength(3);
  // Each rule belongs to the version above it, never to a list item.
  expect(versions.map((v) => v.body.filter((t) => t.type === "hr").length)).toEqual([1, 1, 1]);
});

test("the site changelog has no rule that adds a version heading", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const headings = marked.lexer(published).filter((t) => t.type === "heading" && t.depth === 2);
  expect(parseVersions(published).length).toBe(headings.length - 1); // minus "Unreleased"
});
