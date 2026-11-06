import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-three-entries.md"), "utf8");

/** Raw bullet text of every list item, in the order the parser returns them. */
const entries = (markdown: string) =>
  marked.lexer(markdown).flatMap((t) => (t.type === "list" ? t.items.map((i: { text: string }) => i.text) : []));

test("three entries keep their source order and exact text", () => {
  expect(entries(fixture)).toEqual([
    "Zulu: listed first, sorts last.",
    "Mike `--flag` and **bold** text, listed second.",
    "Alpha: listed third, sorts first.",
  ]);
});

test("source order is not alphabetical", () => {
  const parsed = entries(fixture);
  expect(parsed).not.toEqual([...parsed].sort());
});

test("CRLF line endings give the same three entries", () => {
  expect(entries(fixture.replace(/\n/g, "\r\n"))).toEqual(entries(fixture));
});
