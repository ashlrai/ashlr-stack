import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-nested-lists.md"), "utf8");

/** One line per list item as `<depth>:<own text>`, parents before children, in document order. */
function flatten(items: Tokens.ListItem[], depth = 0): string[] {
  return items.flatMap((item) => {
    const sub = item.tokens.find((t): t is Tokens.List => t.type === "list");
    return [`${depth}:${item.text.split("\n")[0].trim()}`, ...(sub ? flatten(sub.items, depth + 1) : [])];
  });
}

/** Flattened items of every top-level list under the `##` heading with this exact text. */
function entriesFor(markdown: string, version: string): string[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap((t) => (t.type === "list" ? flatten(t.items) : []));
}

test("a parsed entry keeps parent and nested list text in document order", () => {
  expect(entriesFor(fixture, "0.2.0 (2026-02-01)")).toEqual([
    "0:Parent one:",
    "1:child 1a",
    "2:grandchild 1a-i",
    "2:grandchild 1a-ii",
    "1:child 1b",
    "0:Flat entry",
    "0:Parent two with `code` and a [link](https://example.com)",
    "1:child 2a",
  ]);
});

test("nested text does not leak into the neighbouring version", () => {
  expect(entriesFor(fixture, "0.1.0 (2026-01-01)")).toEqual(["0:Older parent", "1:older child"]);
});

test("the raw entry text lists the parent before each of its children", () => {
  const raw = marked
    .lexer(fixture)
    .filter((t): t is Tokens.List => t.type === "list")
    .map((t) => t.raw)
    .join("");
  const order = ["Parent one:", "child 1a", "grandchild 1a-i", "grandchild 1a-ii", "child 1b", "Flat entry", "Parent two", "child 2a", "Older parent", "older child"];
  const positions = order.map((s) => raw.indexOf(s));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});
