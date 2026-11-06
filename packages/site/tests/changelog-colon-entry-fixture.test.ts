import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// The "Site:" entry excerpted from packages/site/src/data/CHANGELOG.md, release 0.2.2 / Changed.
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-colon-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

const PREFIX = "Site: removed the unused";
const REST =
  "package (and five other unused site dependencies). Analytics still loads via the inline script tag in `packages/site/src/layouts/Base.astro`, so nothing changes at runtime.";

function entries(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("the colon in an entry is preserved with the text before and after it", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(1);
  expect(found[0].text).toStartWith(`${PREFIX} \`@vercel/analytics\` ${REST}`);
  expect(found[0].text.indexOf(":")).toBe("Site".length);
});

test("a colon does not turn the entry into a heading, definition or second item", () => {
  const tokens = marked.lexer(fixture);
  expect(tokens.filter((t) => t.type === "heading").map((t) => (t as Tokens.Heading).text)).toEqual([
    "Changelog",
    "0.2.2 (2026-10-25)",
    "Changed",
  ]);
  expect(entries(fixture)).toHaveLength(1);
});

test("the rendered entry keeps the colon and the inline code", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<li>Site: removed the unused <code>@vercel/analytics</code> package");
  expect(html).toContain("<code>packages/site/src/layouts/Base.astro</code>, so nothing changes at runtime.");
});

test("the fixture entry is still present verbatim in the published changelog", () => {
  expect(entries(published).map((e) => e.raw.trim())).toContain(entries(fixture)[0].raw.trim());
});
