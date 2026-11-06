import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-bold-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Text of every `strong` token anywhere inside one token tree, in source order. */
function bold(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    const items = (t as { items?: { tokens: Token[] }[] }).items?.flatMap((i) => i.tokens) ?? [];
    return [...(t.type === "strong" ? [t.text as string] : []), ...bold([...children, ...items])];
  });
}

/** Each list entry under the `##` heading with this exact text: raw source text and bold phrases. */
function entries(markdown: string, version: string): { text: string; bold: string[] }[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => ({ text: item.text, bold: bold(item.tokens) })));
}

test("a parsed entry retains its bold Markdown text, one entry at a time", () => {
  const parsed = entries(fixture, "Unreleased");
  expect(parsed[0].text).toBe("**Bold lead-in:** the rest of the entry.");
  expect(parsed[0].bold).toEqual(["Bold lead-in:"]);
  expect(parsed[1].text).toBe("**Entirely bold entry.**");
  expect(parsed[1].bold).toEqual(["Entirely bold entry."]);
  expect(parsed[2].text).toBe("Plain entry with a **bold** word inside.");
  expect(parsed[2].bold).toEqual(["bold"]);
  expect(parsed[4].text).toBe("Literal \\*\\*not bold\\*\\* stars stay plain.");
  expect(parsed[4].bold).toEqual([]);
});

test("underscore bold is detected and a multi-phrase entry has both phrases", () => {
  const parsed = entries(fixture, "Unreleased");
  expect(parsed[3].bold).toEqual(["underscore bold", "star bold"]);
  expect(parsed[5].text).toContain("**multi-word bold phrase**");
  expect(parsed[5].bold).toEqual(["multi-word bold phrase", "a second phrase"]);
});

test("bold phrases stay with their own version", () => {
  expect(entries(fixture, "0.3.0 (2026-05-01)").flatMap((e) => e.bold)).toEqual([
    "Bold with a [link](https://example.com/docs) inside",
    "Bold child entry.",
  ]);
  expect(entries(fixture, "0.2.0 (2026-04-23)").map((e) => e.bold)).toEqual([["Older bold entry"]]);
});

test("bold phrases do not leak across versions", () => {
  const older = entries(fixture, "0.2.0 (2026-04-23)");
  expect(older.flatMap((e) => e.bold)).not.toContain("Bold lead-in:");
  expect(older.flatMap((e) => e.bold)).not.toContain("Bold child entry.");
});

test("every published Unreleased entry keeps each bold phrase inside its own text", () => {
  const parsed = entries(published, "Unreleased");
  expect(parsed.length).toBeGreaterThan(0);
  for (const entry of parsed) {
    for (const phrase of entry.bold) expect(entry.text).toContain(`**${phrase}**`);
  }
});
