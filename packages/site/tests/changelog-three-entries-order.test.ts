import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-three-entries.md"), "utf8");

/** Raw list-item text of every bullet, in the order the parser returns them. */
function entries(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((token) => (token.type === "list" ? (token as Tokens.List).items.map((item) => item.text) : []));
}

const expected = [
  "Zulu: the entry that sorts last but comes first.",
  "Mike: a `stack apply` entry with [a link](https://stack.ashlr.ai) and **bold** text.",
  "Alpha: the entry that sorts first but comes last.",
];

test("three entries come back in source order, not sorted", () => {
  const parsed = entries(fixture);
  expect(parsed).toEqual(expected);
  expect(parsed).not.toEqual([...parsed].sort());
});

test("entry text is kept verbatim, with inline Markdown intact", () => {
  expect(entries(fixture)[1]).toContain("[a link](https://stack.ashlr.ai)");
  expect(entries(fixture)[1]).toContain("**bold**");
});

test("CRLF source parses to the same three entries in the same order", () => {
  expect(entries(fixture.replace(/\n/g, "\r\n"))).toEqual(expected);
});

test("the real site changelog's first three entries match its first three bullet lines", () => {
  const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const parsed = entries(real);
  expect(parsed.length).toBeGreaterThanOrEqual(3);
  // First three entries match their first three bullet lines in the file.
  const bullets = real.split("\n").filter((line) => line.startsWith("- "));
  parsed.slice(0, 3).forEach((entry, i) => expect(bullets[i]?.slice(2, 40)).toBe(entry.slice(0, 38)));
});
