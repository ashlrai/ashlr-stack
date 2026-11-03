import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released version headings in source order. */
function versionHeadings(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((t) => (t.type === "heading" && t.depth === 2 && VERSION.test(t.text) ? [t.text] : []));
}

test("empty fixture parses to no entries without throwing", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-input.md"), "utf8");
  expect(fixture).toBe("");
  expect(() => versionHeadings(fixture)).not.toThrow();
  expect(versionHeadings(fixture)).toEqual([]);
});

test("whitespace-only and heading-only input also yield no entries", () => {
  for (const input of ["\n", "\r\n\r\n", "  \n\t\n", "# Changelog\n", "# Changelog\n\n## Unreleased\n"]) {
    expect(versionHeadings(input)).toEqual([]);
  }
});

test("the published changelog is not empty, so the empty fixture is a real contrast", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  expect(versionHeadings(published).length).toBeGreaterThan(0);
});

test("the docs page transform renders empty input as empty HTML", async () => {
  // Same steps as src/pages/docs/changelog.astro: strip the H1, then marked.parse.
  const body = "".replace(/^#\s+Changelog\s*\n+/, "");
  expect(await marked.parse(body)).toBe("");
});
