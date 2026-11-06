import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-unicode-wrapped-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Every string a token tree carries: its source text, its raw text and all descendants. */
function texts(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[]; items?: Token[] }).tokens ?? (t as { items?: Token[] }).items ?? [];
    return [t.raw, (t as { text?: string }).text ?? "", ...texts(children)];
  });
}

/** Top-level list entries under the `##` heading with this exact text. */
function entries(markdown: string, heading: string): Tokens.ListItem[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("a Unicode entry wrapped over two lines stays one entry with its text intact", () => {
  const [wrapped, bold] = entries(fixture, "Unreleased");
  expect(wrapped.text).toBe(
    "Wrapped entry: naïve café ☕ and 日本語 continue\non a second line with שלום and 👩‍💻 intact.\n- Nested: Ünïcödé ✓ stays under its parent.",
  );
  expect(bold.text).toBe("**Bold ünï** and _emphasis ñ_ keep their characters 🚀.");
});

test("a nested Unicode entry is parsed under its parent, not as a sibling", () => {
  const [wrapped] = entries(fixture, "Unreleased");
  const nested = wrapped.tokens.find((t): t is Tokens.List => t.type === "list");
  expect(nested?.items.map((i) => i.text)).toEqual(["Nested: Ünïcödé ✓ stays under its parent."]);
  expect(entries(fixture, "Unreleased")).toHaveLength(2);
});

test("emphasis tokens keep their Unicode text", () => {
  const [, bold] = entries(fixture, "Unreleased");
  const inline = texts(bold.tokens);
  expect(inline).toContain("Bold ünï");
  expect(inline).toContain("emphasis ñ");
});

test("the older version's Unicode entry does not move", () => {
  expect(entries(fixture, "0.1.0 (2026-01-01)").map((e) => e.text)).toEqual(["Älter: Ω ≠ µ."]);
});

test("parsing the published changelog drops no non-ASCII character", () => {
  const seen = new Set(texts(marked.lexer(published)).join(""));
  const missing = [...new Set(published)].filter((ch) => /[^\x00-\x7F]/.test(ch) && !seen.has(ch));
  expect(missing).toEqual([]);
  expect([...new Set(published)].some((ch) => /[^\x00-\x7F]/.test(ch))).toBe(true);
});
