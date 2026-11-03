import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Code span text found anywhere inside one token tree, in source order. */
function spans(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "codespan" ? [t.text] : []), ...spans(children)];
  });
}

/** Each list entry under the `##` heading with this exact text: its source text and code spans. */
function entries(markdown: string, version: string): { text: string; code: string[] }[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => ({ text: item.text, code: spans(item.tokens) })));
}

test("a parsed entry retains its code span text, one entry at a time", () => {
  const parsed = entries(fixture, "0.2.0 (2026-05-01)");
  expect(parsed.map((e) => e.code)).toEqual([
    ["stack add <provider>", "--dry-run"],
    ["stack apply", "OPENAI_API_KEY"],
    [],
    [" padded ", "a | b"],
  ]);
  // CommonMark strips one space from each side of a span, so two padding spaces leave one.
  // The entry's own text still carries the backtick delimiters around each span.
  expect(parsed[0].text).toBe("Run `stack add <provider>` to wire a provider; `--dry-run` previews it.");
  expect(parsed[1].text).toContain("**`stack apply`**");
});

test("code spans do not leak into the neighbouring version's entries", () => {
  expect(entries(fixture, "0.1.0 (2026-04-19)").map((e) => e.code)).toEqual([["stack scan"]]);
});

test("every published Unreleased entry keeps each code span inside its own text", () => {
  const parsed = entries(published, "Unreleased");
  expect(parsed.length).toBeGreaterThan(0);
  for (const entry of parsed) {
    for (const code of entry.code) expect(entry.text).toContain(code);
  }
  expect(parsed.flatMap((e) => e.code)).toContain("stack apply");
});
