import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";


/** Inline code spans (`text`) per section heading, in source order. `Unreleased` is its own key. */
function codeByEntry(markdown: string): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  let current: string[] | null = null;
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === "codespan") current?.push(token.text);
      const children = (token as { tokens?: Token[] }).tokens;
      if (children) walk(children);
      const items = (token as { items?: { tokens: Token[] }[] }).items;
      if (items) for (const item of items) walk(item.tokens);
    }
  };
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 ? [] : null;
      if (current) entries.set(token.text, current);
    } else {
      walk([token]);
    }
  }
  return entries;
}

test("inline code stays on its own entry across nesting, repeats, headings and fences", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-edges.md"), "utf8");
  const entries = codeByEntry(fixture);

  expect([...entries.keys()]).toEqual(["Unreleased", "0.3.0 (2026-06-01)", "0.2.0 (2026-05-01)"]);
  expect(entries.get("Unreleased")).toEqual(["stack unreleased"]);
  expect(entries.get("0.3.0 (2026-06-01)")).toEqual([
    "stack fleet",
    "stack apply",
    "a`b",
    "## 0.0.9 (fake)",
    "--json",
    "last-of-0.3.0",
  ]);
  expect(entries.get("0.2.0 (2026-05-01)")).toEqual(["stack apply", "~/.stack/config.json"]);
  // Fenced code is a code block, not inline code, and the fake heading never opened an entry.
  expect([...entries.values()].flat()).not.toContain("stack fenced-only");
  expect(entries.has("0.0.9 (fake)")).toBe(false);
});

test("published changelog: every inline code span belongs to exactly the entry that contains it", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const entries = codeByEntry(published);
  const sections = published.split(/^## /m).slice(1);
  expect(sections.length).toBe(entries.size);
  [...entries].forEach(([heading, spans], index) => {
    expect(sections[index].startsWith(heading)).toBe(true);
    for (const span of spans) expect(sections[index]).toContain(span);
  });
});
