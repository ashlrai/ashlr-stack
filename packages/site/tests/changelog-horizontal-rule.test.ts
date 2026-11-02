import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-horizontal-rule.md"), "utf8");

/** Raw list-item texts between the `##` heading with this exact text and the next version heading or rule. */
function entriesFor(markdown: string, version: string): string[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && ((t.type === "heading" && t.depth <= 2) || t.type === "hr"));
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => item.text.trim()));
}

test("a rule between version sections does not create an extra version", () => {
  const versions = marked
    .lexer(fixture)
    .filter((t): t is Tokens.Heading => t.type === "heading" && t.depth === 2)
    .map((t) => t.text);
  expect(versions).toEqual(["0.3.0 (2026-03-01)", "0.2.0 (2026-02-01)", "0.1.0 (2026-01-01)"]);
});

test("the three rule styles (---, ***, ___) each lex as one rule, not a heading or list", () => {
  const rules = marked.lexer(fixture).filter((t) => t.type === "hr");
  expect(rules).toHaveLength(3);
  expect(marked.lexer(fixture).filter((t) => t.type === "heading" && t.depth === 1)).toHaveLength(1);
});

test("entries stay under their own version and are not merged across a rule", () => {
  expect(entriesFor(fixture, "0.3.0 (2026-03-01)")).toEqual(["Entry A", "Entry B"]);
  expect(entriesFor(fixture, "0.2.0 (2026-02-01)")).toEqual(["Entry C"]);
  expect(entriesFor(fixture, "0.1.0 (2026-01-01)")).toEqual(["Entry D"]);
});

test("the rule does not add list items to the entry before it", () => {
  const items = marked
    .lexer(fixture)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => item.text.trim()));
  expect(items).toEqual(["Entry A", "Entry B", "Entry C", "Entry D"]);
});
