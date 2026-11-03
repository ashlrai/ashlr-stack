import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const read = (...parts: string[]) => readFileSync(join(import.meta.dir, ...parts), "utf8");
const fixture = read("__fixtures__/changelog-punctuated-entry.md");
const published = read("../src/data/CHANGELOG.md");

/** Raw text of every list entry in the markdown, in document order. */
function entries(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => item.text));
}

test("fixture entries keep commas, colons and parentheses verbatim", () => {
  expect(entries(fixture)).toEqual([
    "Fleet reads (`stack fleet`) enforce the byte cap: a non-tail read grows one buffer, probes one extra byte, and rejects an invalid cap (negative, non-integer, or NaN) (#360).",
    "**Wiring, checks: two things** — names (a, b, c): kept; nested (inner (deeper)), done.",
  ]);
});

test("rendered HTML keeps the same punctuation around inline markup", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<code>stack fleet</code>) enforce the byte cap: a non-tail read grows one buffer, probes");
  expect(html).toContain("(negative, non-integer, or NaN) (#360).");
  expect(html).toContain("<strong>Wiring, checks: two things</strong> — names (a, b, c): kept; nested (inner (deeper)), done.");
});

test("a published entry with commas, colons and parentheses parses intact", () => {
  const entry = entries(published).find((text) => text.startsWith("Fleet JSONL reads"));
  expect(entry).toBeDefined();
  expect(entry).toContain("while reading: a non-tail read grows one buffer up to the cap, probes");
  expect(entry).toContain("an invalid cap (negative or non-integer) instead");
  expect(entry?.endsWith("(#360).")).toBe(true);
});
