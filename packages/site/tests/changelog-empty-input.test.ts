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
