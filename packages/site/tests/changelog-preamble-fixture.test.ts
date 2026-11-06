import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/;

/** Version entries are `##` headings that open with a semver; nothing else counts. */
function versionHeadings(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((t) => (t.type === "heading" && t.depth === 2 && VERSION.test(t.text) ? [t.text] : []));
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-preamble.md"), "utf8");

test("introductory prose, bullets and ### headings with semvers are not version entries", () => {
  expect(versionHeadings(fixture)).toEqual(["0.2.0 (2026-04-23)", "0.1.0 (2026-04-19)"]);
});

test("the version right after the preamble is parsed first, with its body", () => {
  const tokens = marked.lexer(fixture);
  const first = tokens.findIndex((t) => t.type === "heading" && t.depth === 2);
  expect(tokens[first]).toMatchObject({ text: "0.2.0 (2026-04-23)" });
  const body = tokens.slice(first + 1).find((t) => t.type === "list");
  expect(body?.raw).toContain("First version entry stays intact.");
});
