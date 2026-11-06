import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// The Homebrew formula entry excerpted from CHANGELOG.md, Unreleased / Fixed.
// It holds parentheses around inline code with `$` delimiters.
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-parenthesized-entry.md"), "utf8");
const source = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

const PARENTHESIZED = "(`$VERSION$` and the per-platform `$SHA_*$` values)";
const ENTRY =
  `The release workflow renders the Homebrew formula placeholders ${PARENTHESIZED} as literals through \`sed\`, ` +
  "so the generated formula no longer depends on shell quoting of the `$` delimiters (#354).";

function entries(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("the parsed entry preserves the parenthesized text and punctuation", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(1);
  expect(found[0].text).toBe(ENTRY);
  expect(found[0].text).toContain(PARENTHESIZED);
  expect(found[0].text).toEndWith("delimiters (#354).");
});

test("parentheses do not split the entry or change the heading structure", () => {
  const tokens = marked.lexer(fixture);
  expect(tokens.filter((t) => t.type === "heading").map((t) => (t as Tokens.Heading).text)).toEqual([
    "Changelog",
    "Unreleased",
    "Fixed",
  ]);
  expect(entries(fixture)).toHaveLength(1);
});

test("the rendered entry keeps the parentheses around inline code", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("(<code>$VERSION$</code> and the per-platform <code>$SHA_*$</code> values)");
  expect(html).toContain("<code>$</code> delimiters (#354).");
});

test("the fixture entry is still present verbatim in both changelogs", () => {
  const raw = entries(fixture)[0].raw.trim();
  for (const changelog of [source, published]) expect(entries(changelog).map((e) => e.raw.trim())).toContain(raw);
});
