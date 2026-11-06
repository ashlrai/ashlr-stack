import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order with the text of every list item in their bodies. */
function parseVersions(markdown: string): { heading: string; items: string[] }[] {
  const versions: { heading: string; items: string[] }[] = [];
  let current: { heading: string; items: string[] } | null = null;
  for (const token of marked.lexer(markdown) as Token[]) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, items: [] } : null;
      if (current) versions.push(current);
    } else if (current && token.type === "list") {
      current.items.push(...token.items.map((i: { text: string }) => i.text.trim()));
    }
  }
  return versions;
}

test("blank lines between entries keep both versions distinct and in input order", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-blank-line-between-entries.md"), "utf8");
  expect(parseVersions(fixture)).toEqual([
    { heading: "0.2.0 (2026-04-23)", items: ["Second entry.", "Second entry, loose item."] },
    { heading: "[0.1.0] — 2026-04-19", items: ["First entry."] },
  ]);
});

test("the gap size between version entries does not change the result", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-blank-line-between-entries.md"), "utf8");
  const expected = parseVersions(fixture);
  for (const gap of ["\n", "\n\n", "\n\n\n\n\n", "\n \n\t\n"]) {
    const input = `## 0.2.0\n\n- b\n${gap}## 0.1.0\n\n- a\n`;
    expect(parseVersions(input).map((v) => v.heading)).toEqual(["0.2.0", "0.1.0"]);
    expect(parseVersions(input).map((v) => v.items)).toEqual([["b"], ["a"]]);
  }
  expect(expected).toHaveLength(2);
});

test("padding the gaps before headings in the real CHANGELOG.md keeps its versions and items in order", () => {
  const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const expected = parseVersions(real);
  expect(expected.length).toBeGreaterThan(1);
  const padded = real.replace(/\n\n(?=#{2,3} )/g, "\n\n\n\n");
  expect(parseVersions(padded)).toEqual(expected);
});

test("blank lines of any size between bullets in one section never create extra entries", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-blank-line-separated-entries.md"), "utf8");
  const items = marked
    .lexer(fixture)
    .flatMap((t) => (t.type === "list" ? t.items.map((i: { text: string }) => i.text.trim()) : []));
  // Six bullet markers in the source → exactly six entries across Unreleased and 0.1.0; a continuation paragraph after a blank line stays inside its entry.
  expect(fixture.split("\n").filter((l) => /^- /.test(l))).toHaveLength(6);
  expect(items).toEqual([
    "Entry one.",
    "Entry two.",
    "Entry three,\n\nwith a continuation paragraph after a blank line.",
    "Entry four.",
    "Entry five.",
    "Entry six.",
  ]);
});
