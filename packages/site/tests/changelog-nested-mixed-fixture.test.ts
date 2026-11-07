import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-nested-mixed.md"), "utf8");

/** Top-level list items under the `##` heading with this exact text. */
function itemsFor(version: string): Tokens.ListItem[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap((t) => (t.type === "list" ? t.items : []));
}

const lists = (item: Tokens.ListItem) => item.tokens.filter((t): t is Tokens.List => t.type === "list");

test("ordered and star-bullet children stay under their parent entry", () => {
  const items = itemsFor("0.4.0 (2026-04-01)");
  expect(items.map((i) => i.text.split("\n")[0].trim())).toEqual([
    "Parent with ordered steps:",
    "Parent with a continuation paragraph",
    "Plain entry",
  ]);

  const [steps] = lists(items[0]);
  expect(steps.ordered).toBe(true);
  expect(steps.items.map((i) => i.text.split("\n")[0].trim())).toEqual(["first step", "second step"]);
  const [deep] = lists(steps.items[1]);
  expect(deep.ordered).toBe(false);
  expect(deep.items.map((i) => i.text)).toEqual(["deep star bullet"]);
  expect(lists(items[2])).toHaveLength(0);
});

test("continuation paragraph, code block and later child belong to the same entry", () => {
  const parent = itemsFor("0.4.0 (2026-04-01)")[1];
  expect(parent.tokens.map((t) => t.type).filter((t) => t !== "space")).toEqual(["paragraph", "paragraph", "code", "list"]);
  expect(parent.raw).toContain("Second paragraph stays with its parent.");
  expect(parent.raw).toContain("stack apply --dry-run");
  expect(lists(parent)[0].items.map((i) => i.text)).toEqual(["child after the code block"]);
});

test("star-bullet parent in the next version does not absorb the previous entries", () => {
  const items = itemsFor("0.3.0 (2026-03-01)");
  expect(items).toHaveLength(1);
  expect(lists(items[0])[0].items.map((i) => i.text)).toEqual(["star child"]);
  expect(items[0].raw).not.toContain("Plain entry");
});
