import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// The "directory-valued" entry excerpted from packages/site/src/data/CHANGELOG.md, release 0.3.0.
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-hyphen-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

const ENTRY = "MCP binary resolution ignores directory-valued package binaries and falls back to PATH (#306).";

function entries(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("the parsed entry keeps its internal hyphen and full text", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(1);
  expect(found[0].text).toBe(ENTRY);
  expect(found[0].text).toContain("directory-valued");
});

test("a hyphen inside the text does not split the entry or add a heading", () => {
  expect(entries(fixture)).toHaveLength(1);
  expect(
    marked
      .lexer(fixture)
      .filter((t): t is Tokens.Heading => t.type === "heading")
      .map((t) => t.text),
  ).toEqual(["Changelog", "0.3.0 (2026-10-31)", "Changed and fixed"]);
});

test("the rendered entry keeps the hyphenated word and the issue reference", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain(`<li>${ENTRY}</li>`);
});

test("the fixture entry is still present verbatim in the published changelog", () => {
  expect(entries(published).map((e) => e.text)).toContain(ENTRY);
});
