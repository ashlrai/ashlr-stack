import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-root-bold-entry.md"), "utf8");
const rootChangelog = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");

const ENTRY = '"Vol. 01 · Issue 2026" corner marks on the hero — tiny but make the page feel **designed**.';

/** Text of every `strong` token inside one token tree, in source order. */
function bold(tokens: Token[]): string[] {
  return tokens.flatMap((t) => [
    ...(t.type === "strong" ? [t.text as string] : []),
    ...bold((t as { tokens?: Token[] }).tokens ?? []),
  ]);
}

/** Every list entry under `## <version> ...`: its raw source text and bold phrases. */
function entries(markdown: string, version: string): { text: string; bold: string[] }[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text.startsWith(`${version} `));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap((t) => (t.type === "list" ? (t as Tokens.List).items : []))
    .map((item) => ({ text: item.text, bold: bold(item.tokens) }));
}

test("root-based fixture entry keeps its bold Markdown and surrounding text", () => {
  expect(entries(fixture, "0.1.0")).toEqual([{ text: ENTRY, bold: ["designed"] }]);
});

test("fixture entry still matches the root CHANGELOG.md", () => {
  expect(entries(rootChangelog, "0.1.0").map((e) => e.text)).toContain(ENTRY);
});
