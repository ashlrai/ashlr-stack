import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-delimiters.md"), "utf8");

/** Code span tokens found anywhere inside one token tree, in source order. */
function spans(tokens: Token[]): Tokens.Codespan[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    const items = (t as { items?: Tokens.ListItem[] }).items ?? [];
    return [
      ...(t.type === "codespan" ? [t as Tokens.Codespan] : []),
      ...spans(children),
      ...items.flatMap((i) => spans(i.tokens)),
    ];
  });
}

/** List entries under the `##` heading with this exact text. */
function entries(version: string): Tokens.ListItem[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("multi-backtick delimiters stay in the entry source and out of the span text", () => {
  const [double, triple] = entries("0.6.0 (2026-08-01)");
  expect(spans(double.tokens).map((s) => [s.raw, s.text])).toEqual([["``stack add `x`y``", "stack add `x`y"]]);
  expect(double.text).toContain("``stack add `x`y``");
  expect(spans(triple.tokens).map((s) => [s.raw, s.text])).toEqual([["```a``b```", "a``b"]]);
  expect(triple.text).toContain("```a``b```");
});

test("a span wrapped over two source lines stays one span inside its entry", () => {
  const wrapped = entries("0.6.0 (2026-08-01)")[2];
  const [only] = spans(wrapped.tokens);
  expect(spans(wrapped.tokens)).toHaveLength(1);
  expect(only.raw.startsWith("`stack apply")).toBe(true);
  expect(only.raw.endsWith("--dry-run`")).toBe(true);
  expect(wrapped.text).toContain(only.raw);
});

test("an escaped backtick is plain text, not a span", () => {
  const entry = entries("0.6.0 (2026-08-01)")[3];
  expect(spans(entry.tokens)).toEqual([]);
  expect(entry.text).toContain("\\`tick\\`");
});

test("a span in a nested item belongs to the nested item and its parent", () => {
  const parent = entries("0.6.0 (2026-08-01)")[4];
  expect(spans(parent.tokens).map((s) => s.raw)).toEqual(["`--json`"]);
  expect(parent.text).toContain("`--json`");
});

test("delimiters render as <code> and neighbouring versions keep their own spans", () => {
  const html = marked.parse(fixture) as string;
  expect(html).toContain("<code>stack add `x`y</code>");
  expect(html).toContain("<code>a``b</code>");
  expect(spans(entries("0.5.0 (2026-07-01)").flatMap((e) => e.tokens)).map((s) => s.text)).toEqual(["stack scan"]);
});
