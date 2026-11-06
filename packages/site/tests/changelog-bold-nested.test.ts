import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-bold-nested.md"), "utf8");

/** Text of every `strong` token anywhere under the given tokens, in source order. */
function bold(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    const items = (t as { items?: { tokens: Token[] }[] }).items?.flatMap((i) => i.tokens) ?? [];
    return [...(t.type === "strong" ? [t.text as string] : []), ...bold([...children, ...items])];
  });
}

/** Top-level list items under the `##` heading that starts with `version`. */
function entries(version: string) {
  const tokens = marked.lexer(fixture) as Token[];
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text.startsWith(version));
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth === 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap((t) => (t.type === "list" ? t.items : []) as { text: string; tokens: Token[] }[]);
}

test("bold wrapping a link keeps the link and the Markdown source", () => {
  const [entry] = entries("0.4.0");
  expect(entry.text).toBe("**Bold with a [link](https://example.com/docs) inside** and a `code` tail.");
  expect(bold(entry.tokens)).toEqual(["Bold with a [link](https://example.com/docs) inside"]);
});

test("bold that wraps across a source line stays in one entry", () => {
  const entry = entries("0.4.0")[1];
  expect(entry.text).toContain("**wraps onto\nthe next line**");
  expect(bold(entry.tokens)).toEqual(["wraps onto\nthe next line"]);
});

test("bold in nested children is kept and the parent is not bold", () => {
  const parent = entries("0.4.0")[2];
  expect(parent.text.startsWith("Parent entry with children:")).toBe(true);
  expect(bold(parent.tokens)).toEqual(["Nested bold child.", "bold"]);
});

test("bold in an older version does not leak into the newer one", () => {
  expect(entries("0.3.0").map((e) => bold(e.tokens))).toEqual([["Older bold entry"]]);
  expect(entries("0.4.0")).toHaveLength(3);
});
