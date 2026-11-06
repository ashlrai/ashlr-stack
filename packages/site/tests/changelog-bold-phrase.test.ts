import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-bold-phrase.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Text of every strong span found anywhere inside one token tree, in source order. */
function bold(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "strong" ? [t.text] : []), ...bold(children)];
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

test("an entry is returned with its bold Markdown text intact", () => {
  const parsed = entries(fixture, "Unreleased");
  expect(parsed[0].text).toBe("Secrets are **never written to the vault by `stack apply`** unless you pass a real value.");
  expect(parsed[0].bold).toEqual(["never written to the vault by `stack apply`"]);
  expect(parsed[3].text).toBe("A **multi-word bold phrase** mid-sentence, then **a second phrase** after it.");
  expect(parsed[3].bold).toEqual(["multi-word bold phrase", "a second phrase"]);
});

test("underscore bold is detected and escaped stars are not", () => {
  const parsed = entries(fixture, "Unreleased");
  expect(parsed[1].bold).toEqual(["underscore bold", "star bold"]);
  expect(parsed[1].text).toContain("__underscore bold__");
  expect(parsed[2].bold).toEqual([]);
  expect(parsed[2].text).toBe("Literal \\*\\*not bold\\*\\* stars stay plain.");
});

test("bold phrases stay with their own version", () => {
  expect(entries(fixture, "0.1.0 (2026-04-19)").map((e) => e.bold)).toEqual([["bold phrase"]]);
});

test("every published Unreleased entry keeps each bold phrase inside its own text", () => {
  for (const entry of entries(published, "Unreleased")) {
    for (const phrase of entry.bold) expect(entry.text).toContain(`**${phrase}**`);
  }
});
